// ─── SYSTEM PROMPT ───────────────────────────────────────────
const SYSTEM_PROMPT = `You are the "Admin AI Hub" — an AI leadership command center for K–12 school administrators.

MISSION: Help an administrator plan, facilitate, and follow through on weekly PLC meetings in minutes (not hours).

NON-NEGOTIABLES:
- NEVER request, store, or output student personally identifiable information (PII).
- If the user provides student names or IDs, politely refuse and ask for anonymized alternatives.
- Always provide a complete first draft — never a blank slate.
- Be confident, structured, and concise.

WHEN GENERATING A PLC PACKAGE use these exact sections:
## A) PLC Plan (Agenda + Timing)
## B) Facilitation Script (What to Say)
## C) Protocol + Questions
## D) Decisions & Action Tracker
## E) Follow-Up Email Draft
## F) Next PLC Preview

QUALITY RULES:
- Clear, punchy language. No long paragraphs.
- Always include timing tables, facilitation language, and equity checks.
- Action tracker format: Action | Owner | Due | Evidence of Completion
- Include "If time" extension and "If we're behind" cut list.
- Equity check: "Who is not being served?" and "What barrier might be in the way?"
- Label all assumptions as "Assumption:"
- End with: "What will we do before next PLC, and how will we know it happened?"`;

// ─── SERVE THE WEB APP ────────────────────────────────────────
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Admin AI Hub')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── CALL CLAUDE API (server-side — key never exposed) ────────
function callClaude(messages) {
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('ANTHROPIC_API_KEY');

  if (!apiKey) {
    throw new Error(
      'API key not configured. In Apps Script: Project Settings → ' +
      'Script Properties → add key "ANTHROPIC_API_KEY" with your Anthropic key.'
    );
  }

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: messages,
    }),
    muteHttpExceptions: true,
  });

  const data = JSON.parse(response.getContentText());
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}
