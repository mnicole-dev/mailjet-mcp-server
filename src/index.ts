#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = 'https://api.mailjet.com';

function getCredentials(): { apiKey: string; secretKey: string } {
  const apiKey = process.env['MJ_APIKEY_PUBLIC'];
  const secretKey = process.env['MJ_APIKEY_PRIVATE'];
  if (!apiKey) throw new Error('MJ_APIKEY_PUBLIC environment variable is required');
  if (!secretKey) throw new Error('MJ_APIKEY_PRIVATE environment variable is required');
  return { apiKey, secretKey };
}

function authHeader(): string {
  const { apiKey, secretKey } = getCredentials();
  return `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;
}

async function mjFetch(
  path: string,
  options?: RequestInit & { params?: Record<string, string> },
): Promise<Response> {
  let url = `${API_BASE}${path}`;
  if (options?.params) {
    const qs = new URLSearchParams(options.params).toString();
    if (qs) url += `?${qs}`;
  }
  const { params: _, ...fetchOptions } = options ?? {};
  return fetch(url, {
    ...fetchOptions,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...fetchOptions?.headers,
    },
  });
}

async function assertOk(resp: Response, action: string): Promise<unknown> {
  if (resp.ok) return resp.json();
  const body = await resp.text();
  throw new Error(`${action} failed (${resp.status}): ${body}`);
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

const server = new McpServer({ name: 'mailjet-mcp-server', version: '1.0.0' });

// ── Send Email (v3.1) ─────────────────────────────────────

const recipientSchema = z.object({
  Email: z.string().describe('Email address'),
  Name: z.string().optional().describe('Display name'),
});

const attachmentSchema = z.object({
  ContentType: z.string().describe('MIME type (e.g. application/pdf)'),
  Filename: z.string().describe('File name'),
  Base64Content: z.string().describe('Base64-encoded file content'),
});

server.tool(
  'send-email',
  'Send a transactional email via Mailjet v3.1 API.',
  {
    fromEmail: z.string().describe('Sender email address'),
    fromName: z.string().optional().describe('Sender display name'),
    to: z.array(recipientSchema).describe('Primary recipients'),
    cc: z.array(recipientSchema).optional().describe('CC recipients'),
    bcc: z.array(recipientSchema).optional().describe('BCC recipients'),
    subject: z.string().describe('Email subject'),
    textPart: z.string().optional().describe('Plain text body'),
    htmlPart: z.string().optional().describe('HTML body'),
    templateId: z.number().optional().describe('Mailjet Template ID (overrides text/html)'),
    templateLanguage: z.boolean().optional().describe('Enable template language (variables)'),
    variables: z.string().optional().describe('Template variables as JSON string (e.g. {"name":"John","amount":42})'),
    replyToEmail: z.string().optional().describe('Reply-to email'),
    replyToName: z.string().optional().describe('Reply-to name'),
    attachments: z.array(attachmentSchema).optional().describe('File attachments'),
    customId: z.string().optional().describe('Custom ID for tracking'),
    customCampaign: z.string().optional().describe('Campaign name for grouping stats'),
    trackOpens: z.enum(['enabled', 'disabled', 'account_default']).optional().describe('Open tracking'),
    trackClicks: z.enum(['enabled', 'disabled', 'account_default']).optional().describe('Click tracking'),
    sandboxMode: z.boolean().optional().describe('Validate without sending'),
  },
  async (params) => {
    const message: Record<string, unknown> = {
      From: { Email: params.fromEmail, Name: params.fromName },
      To: params.to,
      Subject: params.subject,
    };
    if (params.cc) message['Cc'] = params.cc;
    if (params.bcc) message['Bcc'] = params.bcc;
    if (params.textPart) message['TextPart'] = params.textPart;
    if (params.htmlPart) message['HTMLPart'] = params.htmlPart;
    if (params.templateId) message['TemplateID'] = params.templateId;
    if (params.templateLanguage) message['TemplateLanguage'] = params.templateLanguage;
    if (params.variables) message['Variables'] = JSON.parse(params.variables);
    if (params.replyToEmail) message['ReplyTo'] = { Email: params.replyToEmail, Name: params.replyToName };
    if (params.attachments) message['Attachments'] = params.attachments;
    if (params.customId) message['CustomID'] = params.customId;
    if (params.customCampaign) message['CustomCampaign'] = params.customCampaign;
    if (params.trackOpens) message['TrackOpens'] = params.trackOpens;
    if (params.trackClicks) message['TrackClicks'] = params.trackClicks;

    const body: Record<string, unknown> = { Messages: [message] };
    if (params.sandboxMode) body['SandboxMode'] = true;

    const resp = await mjFetch('/v3.1/send', { method: 'POST', body: JSON.stringify(body) });
    const data = (await assertOk(resp, 'Send email')) as {
      Messages: Array<{
        Status: string;
        To: Array<{ Email: string; MessageUUID: string; MessageID: number }>;
        Errors?: Array<{ ErrorMessage: string }>;
      }>;
    };
    const msg = data.Messages[0];
    if (!msg) throw new Error('No message response');
    if (msg.Status !== 'success') {
      const errs = msg.Errors?.map((e) => e.ErrorMessage).join('; ') ?? 'Unknown error';
      throw new Error(`Send failed: ${errs}`);
    }
    const recipients = msg.To.map((r) => `${r.Email} (ID: ${r.MessageID})`).join(', ');
    return textResult(`Email sent!\n- To: ${recipients}\n- Status: ${msg.Status}`);
  },
);

// ── Contacts ───────────────────────────────────────────────

server.tool(
  'list-contacts',
  'List contacts with optional filters.',
  {
    limit: z.number().min(1).max(1000).default(50).describe('Results per page'),
    offset: z.number().default(0).describe('Pagination offset'),
    sort: z.string().optional().describe('Sort field (e.g. "ID desc")'),
  },
  async (params) => {
    const qp: Record<string, string> = { Limit: String(params.limit), Offset: String(params.offset) };
    if (params.sort) qp['Sort'] = params.sort;

    const resp = await mjFetch('/v3/REST/contact', { params: qp });
    const data = (await assertOk(resp, 'List contacts')) as {
      Count: number; Total: number;
      Data: Array<{ ID: number; Email: string; Name: string; IsExcludedFromCampaigns: boolean; CreatedAt: string }>;
    };
    if (data.Data.length === 0) return textResult('No contacts found.');
    const lines = data.Data.map((c) => {
      const excluded = c.IsExcludedFromCampaigns ? ' [EXCLUDED]' : '';
      const name = c.Name ? ` (${c.Name})` : '';
      return `- **${c.Email}**${name}${excluded} (id: ${c.ID})`;
    });
    lines.push(`\n_Showing ${data.Count} of ${data.Total} contacts_`);
    return textResult(lines.join('\n'));
  },
);

server.tool(
  'get-contact',
  'Get a contact by ID or email address.',
  { idOrEmail: z.string().describe('Contact ID or email address') },
  async ({ idOrEmail }) => {
    const resp = await mjFetch(`/v3/REST/contact/${encodeURIComponent(idOrEmail)}`);
    const data = (await assertOk(resp, 'Get contact')) as {
      Data: Array<{ ID: number; Email: string; Name: string; IsExcludedFromCampaigns: boolean; CreatedAt: string }>;
    };
    const c = data.Data[0];
    if (!c) throw new Error('Contact not found');
    return textResult(`**${c.Email}**\nName: ${c.Name || 'none'}\nExcluded: ${c.IsExcludedFromCampaigns}\nCreated: ${c.CreatedAt}\nID: ${c.ID}`);
  },
);

server.tool(
  'create-contact',
  'Create a new contact.',
  {
    email: z.string().describe('Email address'),
    name: z.string().optional().describe('Contact name'),
    isExcludedFromCampaigns: z.boolean().optional().describe('Exclude from campaigns'),
  },
  async (params) => {
    const body: Record<string, unknown> = { Email: params.email };
    if (params.name) body['Name'] = params.name;
    if (params.isExcludedFromCampaigns !== undefined) body['IsExcludedFromCampaigns'] = params.isExcludedFromCampaigns;

    const resp = await mjFetch('/v3/REST/contact', { method: 'POST', body: JSON.stringify(body) });
    const data = (await assertOk(resp, 'Create contact')) as { Data: Array<{ ID: number; Email: string }> };
    const c = data.Data[0]!;
    return textResult(`Contact created: **${c.Email}** (id: ${c.ID})`);
  },
);

server.tool(
  'update-contact',
  'Update a contact.',
  {
    id: z.number().describe('Contact ID'),
    name: z.string().optional().describe('New name'),
    isExcludedFromCampaigns: z.boolean().optional().describe('Exclude from campaigns'),
  },
  async (params) => {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body['Name'] = params.name;
    if (params.isExcludedFromCampaigns !== undefined) body['IsExcludedFromCampaigns'] = params.isExcludedFromCampaigns;

    const resp = await mjFetch(`/v3/REST/contact/${params.id}`, { method: 'PUT', body: JSON.stringify(body) });
    const data = (await assertOk(resp, 'Update contact')) as { Data: Array<{ ID: number; Email: string }> };
    return textResult(`Contact updated: **${data.Data[0]!.Email}** (id: ${data.Data[0]!.ID})`);
  },
);

server.tool(
  'manage-contact-lists',
  'Subscribe or unsubscribe a contact from lists.',
  {
    contactId: z.number().describe('Contact ID'),
    lists: z.array(z.object({
      ListID: z.number().describe('Contact list ID'),
      Action: z.enum(['addforce', 'addnoforce', 'remove', 'unsub']).describe('Action'),
    })).describe('List actions'),
  },
  async ({ contactId, lists }) => {
    const resp = await mjFetch(`/v3/REST/contact/${contactId}/managecontactslists`, {
      method: 'POST',
      body: JSON.stringify({ ContactsLists: lists }),
    });
    await assertOk(resp, 'Manage contact lists');
    return textResult(`Contact ${contactId}: ${lists.length} list action(s) applied.`);
  },
);

// ── Contact Lists ──────────────────────────────────────────

server.tool(
  'list-contact-lists',
  'List all contact lists.',
  {
    limit: z.number().min(1).max(1000).default(50).describe('Results per page'),
    offset: z.number().default(0).describe('Pagination offset'),
  },
  async (params) => {
    const resp = await mjFetch('/v3/REST/contactslist', { params: { Limit: String(params.limit), Offset: String(params.offset) } });
    const data = (await assertOk(resp, 'List contact lists')) as {
      Data: Array<{ ID: number; Name: string; SubscriberCount: number; IsDeleted: boolean }>;
      Total: number;
    };
    if (data.Data.length === 0) return textResult('No contact lists found.');
    const lines = data.Data.map((l) => {
      const deleted = l.IsDeleted ? ' [DELETED]' : '';
      return `- **${l.Name}**: ${l.SubscriberCount} subscribers${deleted} (id: ${l.ID})`;
    });
    lines.push(`\n_Total: ${data.Total} lists_`);
    return textResult(lines.join('\n'));
  },
);

server.tool(
  'create-contact-list',
  'Create a new contact list.',
  { name: z.string().describe('List name') },
  async ({ name }) => {
    const resp = await mjFetch('/v3/REST/contactslist', { method: 'POST', body: JSON.stringify({ Name: name }) });
    const data = (await assertOk(resp, 'Create list')) as { Data: Array<{ ID: number; Name: string }> };
    return textResult(`List created: **${data.Data[0]!.Name}** (id: ${data.Data[0]!.ID})`);
  },
);

server.tool(
  'update-contact-list',
  'Update a contact list.',
  {
    id: z.number().describe('List ID'),
    name: z.string().optional().describe('New name'),
  },
  async (params) => {
    const body: Record<string, unknown> = {};
    if (params.name) body['Name'] = params.name;
    const resp = await mjFetch(`/v3/REST/contactslist/${params.id}`, { method: 'PUT', body: JSON.stringify(body) });
    await assertOk(resp, 'Update list');
    return textResult(`List ${params.id} updated.`);
  },
);

server.tool(
  'delete-contact-list',
  'Delete a contact list.',
  { id: z.number().describe('List ID') },
  async ({ id }) => {
    const resp = await mjFetch(`/v3/REST/contactslist/${id}`, { method: 'DELETE' });
    if (!resp.ok) { const b = await resp.text(); throw new Error(`Delete failed (${resp.status}): ${b}`); }
    return textResult(`List ${id} deleted.`);
  },
);

server.tool(
  'add-contact-to-list',
  'Add or manage a single contact on a list.',
  {
    listId: z.number().describe('Contact list ID'),
    email: z.string().describe('Contact email'),
    name: z.string().optional().describe('Contact name'),
    action: z.enum(['addforce', 'addnoforce', 'remove', 'unsub']).default('addforce').describe('Action'),
    properties: z.string().optional().describe('Contact properties as JSON string'),
  },
  async (params) => {
    const body: Record<string, unknown> = { Email: params.email, Action: params.action };
    if (params.name) body['Name'] = params.name;
    if (params.properties) body['Properties'] = JSON.parse(params.properties);

    const resp = await mjFetch(`/v3/REST/contactslist/${params.listId}/ManageContact`, {
      method: 'POST', body: JSON.stringify(body),
    });
    await assertOk(resp, 'Add contact to list');
    return textResult(`${params.action}: **${params.email}** on list ${params.listId}`);
  },
);

// ── Templates ──────────────────────────────────────────────

server.tool(
  'list-templates',
  'List email templates.',
  {
    limit: z.number().min(1).max(1000).default(50).describe('Results per page'),
    offset: z.number().default(0).describe('Pagination offset'),
    ownerType: z.enum(['user', 'apikey']).optional().describe('Filter by owner type'),
  },
  async (params) => {
    const qp: Record<string, string> = { Limit: String(params.limit), Offset: String(params.offset) };
    if (params.ownerType) qp['OwnerType'] = params.ownerType;

    const resp = await mjFetch('/v3/REST/template', { params: qp });
    const data = (await assertOk(resp, 'List templates')) as {
      Data: Array<{ ID: number; Name: string; Author: string; EditMode: number; IsStarred: boolean }>;
      Total: number;
    };
    if (data.Data.length === 0) return textResult('No templates found.');
    const lines = data.Data.map((t) => {
      const starred = t.IsStarred ? ' [STARRED]' : '';
      const mode = t.EditMode === 1 ? 'drag-drop' : 'html';
      return `- **${t.Name}** by ${t.Author || 'unknown'} (${mode})${starred} (id: ${t.ID})`;
    });
    lines.push(`\n_Total: ${data.Total} templates_`);
    return textResult(lines.join('\n'));
  },
);

server.tool(
  'get-template',
  'Get a template by ID.',
  { id: z.number().describe('Template ID') },
  async ({ id }) => {
    const resp = await mjFetch(`/v3/REST/template/${id}`);
    const data = (await assertOk(resp, 'Get template')) as {
      Data: Array<{ ID: number; Name: string; Author: string; EditMode: number; Purposes: string[] }>;
    };
    const t = data.Data[0];
    if (!t) throw new Error('Template not found');
    return textResult(`**${t.Name}**\nAuthor: ${t.Author || 'unknown'}\nPurposes: ${t.Purposes?.join(', ') || 'none'}\nID: ${t.ID}`);
  },
);

server.tool(
  'create-template',
  'Create a new email template.',
  {
    name: z.string().describe('Template name'),
    author: z.string().optional().describe('Author name'),
    purposes: z.array(z.enum(['transactional', 'marketing'])).optional().describe('Template purposes'),
  },
  async (params) => {
    const body: Record<string, unknown> = { Name: params.name };
    if (params.author) body['Author'] = params.author;
    if (params.purposes) body['Purposes'] = params.purposes;

    const resp = await mjFetch('/v3/REST/template', { method: 'POST', body: JSON.stringify(body) });
    const data = (await assertOk(resp, 'Create template')) as { Data: Array<{ ID: number; Name: string }> };
    return textResult(`Template created: **${data.Data[0]!.Name}** (id: ${data.Data[0]!.ID})`);
  },
);

server.tool(
  'set-template-content',
  'Set the HTML/text content of a template.',
  {
    id: z.number().describe('Template ID'),
    htmlPart: z.string().optional().describe('HTML content'),
    textPart: z.string().optional().describe('Plain text content'),
  },
  async (params) => {
    const body: Record<string, unknown> = {};
    if (params.htmlPart) body['Html-part'] = params.htmlPart;
    if (params.textPart) body['Text-part'] = params.textPart;

    const resp = await mjFetch(`/v3/REST/template/${params.id}/detailcontent`, {
      method: 'POST', body: JSON.stringify(body),
    });
    await assertOk(resp, 'Set template content');
    return textResult(`Template ${params.id} content updated.`);
  },
);

server.tool(
  'delete-template',
  'Delete a template.',
  { id: z.number().describe('Template ID') },
  async ({ id }) => {
    const resp = await mjFetch(`/v3/REST/template/${id}`, { method: 'DELETE' });
    if (!resp.ok) { const b = await resp.text(); throw new Error(`Delete failed (${resp.status}): ${b}`); }
    return textResult(`Template ${id} deleted.`);
  },
);

// ── Senders ────────────────────────────────────────────────

server.tool(
  'list-senders',
  'List authorized sender addresses.',
  {},
  async () => {
    const resp = await mjFetch('/v3/REST/sender', { params: { Limit: '100' } });
    const data = (await assertOk(resp, 'List senders')) as {
      Data: Array<{ ID: number; Email: string; Name: string; Status: string; IsDefaultSender: boolean }>;
    };
    if (data.Data.length === 0) return textResult('No senders found.');
    const lines = data.Data.map((s) => {
      const def = s.IsDefaultSender ? ' [DEFAULT]' : '';
      return `- **${s.Email}** (${s.Name || 'no name'}) [${s.Status}]${def} (id: ${s.ID})`;
    });
    return textResult(lines.join('\n'));
  },
);

// ── Messages & Stats ───────────────────────────────────────

server.tool(
  'list-messages',
  'List sent messages with optional filters.',
  {
    limit: z.number().min(1).max(1000).default(50).describe('Results per page'),
    offset: z.number().default(0).describe('Pagination offset'),
    showSubject: z.boolean().default(true).describe('Include subject in results'),
  },
  async (params) => {
    const qp: Record<string, string> = {
      Limit: String(params.limit),
      Offset: String(params.offset),
      showSubject: String(params.showSubject),
    };
    const resp = await mjFetch('/v3/REST/message', { params: qp });
    const data = (await assertOk(resp, 'List messages')) as {
      Data: Array<{ ID: number; ArrivedAt: string; Status: string; Subject?: string; ContactAlt: string; SenderID: number }>;
      Total: number;
    };
    if (data.Data.length === 0) return textResult('No messages found.');
    const lines = data.Data.map((m) => {
      const subject = m.Subject ? ` — ${m.Subject}` : '';
      return `- **${m.ContactAlt}** [${m.Status}] ${m.ArrivedAt}${subject} (id: ${m.ID})`;
    });
    lines.push(`\n_Showing ${data.Data.length} of ${data.Total} messages_`);
    return textResult(lines.join('\n'));
  },
);

server.tool(
  'get-message',
  'Get details of a sent message by ID.',
  { id: z.number().describe('Message ID') },
  async ({ id }) => {
    const resp = await mjFetch(`/v3/REST/message/${id}`);
    const data = (await assertOk(resp, 'Get message')) as {
      Data: Array<{ ID: number; ArrivedAt: string; Status: string; ContactAlt: string; Subject?: string }>;
    };
    const m = data.Data[0];
    if (!m) throw new Error('Message not found');
    return textResult(`**Message ${m.ID}**\nTo: ${m.ContactAlt}\nStatus: ${m.Status}\nArrived: ${m.ArrivedAt}\nSubject: ${m.Subject || 'unknown'}`);
  },
);

server.tool(
  'get-campaign-statistics',
  'Get campaign statistics.',
  {
    limit: z.number().min(1).max(1000).default(50).describe('Results per page'),
    offset: z.number().default(0).describe('Pagination offset'),
  },
  async (params) => {
    const resp = await mjFetch('/v3/REST/campaignstatistics', {
      params: { Limit: String(params.limit), Offset: String(params.offset) },
    });
    const data = (await assertOk(resp, 'Campaign stats')) as {
      Data: Array<{
        CampaignID: number; ProcessedCount: number; DeliveredCount: number;
        OpenedCount: number; ClickedCount: number; BouncedCount: number;
        SpamComplaintCount: number; UnsubscribedCount: number;
      }>;
      Total: number;
    };
    if (data.Data.length === 0) return textResult('No campaign statistics found.');
    const lines = data.Data.map((s) => {
      return `- Campaign ${s.CampaignID}: sent ${s.ProcessedCount}, delivered ${s.DeliveredCount}, opened ${s.OpenedCount}, clicked ${s.ClickedCount}, bounced ${s.BouncedCount}, spam ${s.SpamComplaintCount}, unsub ${s.UnsubscribedCount}`;
    });
    lines.push(`\n_Total: ${data.Total} campaigns_`);
    return textResult(lines.join('\n'));
  },
);

server.tool(
  'get-message-history',
  'Get delivery event history for a message.',
  { id: z.number().describe('Message ID') },
  async ({ id }) => {
    const resp = await mjFetch(`/v3/REST/messagehistory/${id}`);
    const data = (await assertOk(resp, 'Message history')) as {
      Data: Array<{ EventAt: string; EventType: string; Comment: string }>;
    };
    if (data.Data.length === 0) return textResult('No history events found.');
    const lines = data.Data.map((e) => `- ${e.EventAt}: **${e.EventType}** ${e.Comment || ''}`);
    return textResult(lines.join('\n'));
  },
);

// ── Webhooks ───────────────────────────────────────────────

server.tool(
  'list-webhooks',
  'List event callback webhooks.',
  {},
  async () => {
    const resp = await mjFetch('/v3/REST/eventcallbackurl', { params: { Limit: '100' } });
    const data = (await assertOk(resp, 'List webhooks')) as {
      Data: Array<{ ID: number; EventType: string; Url: string; Status: string; Version: number }>;
    };
    if (data.Data.length === 0) return textResult('No webhooks found.');
    const lines = data.Data.map((w) => `- **${w.EventType}** → ${w.Url} [${w.Status}] v${w.Version} (id: ${w.ID})`);
    return textResult(lines.join('\n'));
  },
);

server.tool(
  'create-webhook',
  'Create a webhook for email events.',
  {
    eventType: z.enum(['sent', 'open', 'click', 'bounce', 'spam', 'blocked', 'unsub']).describe('Event type'),
    url: z.string().describe('Webhook URL'),
    version: z.number().default(2).describe('Webhook version (1 or 2)'),
  },
  async (params) => {
    const body = { EventType: params.eventType, Url: params.url, Version: params.version };
    const resp = await mjFetch('/v3/REST/eventcallbackurl', { method: 'POST', body: JSON.stringify(body) });
    const data = (await assertOk(resp, 'Create webhook')) as { Data: Array<{ ID: number; EventType: string }> };
    return textResult(`Webhook created: **${data.Data[0]!.EventType}** (id: ${data.Data[0]!.ID})`);
  },
);

server.tool(
  'delete-webhook',
  'Delete a webhook.',
  { id: z.number().describe('Webhook ID') },
  async ({ id }) => {
    const resp = await mjFetch(`/v3/REST/eventcallbackurl/${id}`, { method: 'DELETE' });
    if (!resp.ok) { const b = await resp.text(); throw new Error(`Delete failed (${resp.status}): ${b}`); }
    return textResult(`Webhook ${id} deleted.`);
  },
);

// ── Account ────────────────────────────────────────────────

server.tool(
  'get-profile',
  'Get your Mailjet account profile.',
  {},
  async () => {
    const resp = await mjFetch('/v3/REST/myprofile');
    const data = (await assertOk(resp, 'Get profile')) as {
      Data: Array<{ ID: number; Email: string; FirstName: string; LastName: string; CompanyName: string; Country: string }>;
    };
    const p = data.Data[0];
    if (!p) throw new Error('Profile not found');
    return textResult(`**${p.FirstName} ${p.LastName}**\nEmail: ${p.Email}\nCompany: ${p.CompanyName || 'none'}\nCountry: ${p.Country || 'unknown'}\nID: ${p.ID}`);
  },
);

// ── Start ──────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
