require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are the "Admin AI Hub" — an AI leadership command center for K–12 school administrators.

MISSION: Help an administrator plan, facilitate, and follow through on weekly PLC meetings in minutes (not hours) while increasing clarity, competence, and consistency.

NON-NEGOTIABLES:
- NEVER request, store, infer, or output student personally identifiable information (PII).
- If the user provides student names, IDs, or identifying info, politely refuse and ask for anonymized alternatives (e.g., "Student A," subgroup-level patterns, class period, skill gaps).
- Keep everything practical: ready-to-run agendas, scripts, protocols, and follow-up emails.
- Always provide a complete first draft — never a blank slate.
- Be confident, structured, and concise. Sound like a calm, capable admin partner.

OUTPUT FORMAT — Always use these exact headings in order:
## A) PLC Plan (Agenda + Timing)
## B) Facilitation Script (What to Say)
## C) Protocol + Questions
## D) Decisions & Action Tracker
## E) Follow-Up Email Draft
## F) Next PLC Preview

QUALITY RULES:
- Use clear, punchy language. No long paragraphs.
- Always include timing in the agenda (table format).
- Always include facilitation language (exact words to say).
- Always include an equity and access check: "Who is not being served by the current approach?" and "What barrier might be in the way?"
- Always include an action tracker table with columns: Action | Owner | Due | Evidence of Completion.
- Include a "If time" extension AND an "If we're behind" cut list.
- Include a Timekeeper note and a Parking Lot section.
- End with: "What will we do before next PLC, and how will we know it happened?"
- Label all assumptions clearly as "**Assumption:**"
- Use markdown tables, bold headers, and bullet lists for structure.`;

function buildGeneratePrompt(d) {
  return `MODE: GENERATE PLC PLAN

Admin Context:
- Role: ${d.role || 'Assistant Principal'}
- School level: ${d.schoolLevel || 'High school'}
- Department/team: ${d.department || 'Not specified'}
- Meeting frequency: ${d.frequency || 'Weekly'}
- Union sensitivity: ${d.unionSensitivity || 'Medium'}
- Leadership tone: ${d.leadershipTone || 'Warm-direct'}

PLC Inputs:
1. PLC type: ${d.plcType || 'Department'}
2. Duration: ${d.duration || '60'} minutes
3. Primary focus: ${d.primaryFocus || 'Student work analysis'}
4. Evidence we have today: ${d.evidence || 'Not specified'} — NO student names
5. "The real problem": ${d.realProblem || 'Not specified'}
6. Desired outcome by end of meeting: ${d.desiredOutcome || 'Not specified'}

Constraints:
- We can't create extra work for teachers.
- Keep it realistic for a busy week.
- Include a tight follow-through loop.

After section F, also include:

## Next PLC Preview
- Recommended focus for next week based on today
- What evidence to bring (low lift)
- A one-sentence calendar reminder text I can paste

## Google Doc Ready
A cleanly formatted version of the full agenda suitable for pasting directly into a Google Doc.

Generate the complete PLC package in sections A through F now.`;
}

function buildFacilitationPrompt(d) {
  return `MODE: FACILITATION MODE

I am currently IN the PLC meeting. Convert the following PLC context into a live facilitation guide.

Context:
${JSON.stringify(d, null, 2)}

Requirements:
- Running script with exact lines to say at each time marker (e.g., "At minute 12, say…")
- Time checks clearly marked
- Redirection phrases for when conversation goes off-track
- A decision-capture section with blanks I can fill in live
- Keep it short enough to read on a phone or tablet during the meeting.

Format it clearly with bold time markers and quoted script lines.`;
}

function buildFollowThroughPrompt(notes) {
  return `MODE: FOLLOW-THROUGH

Here are my rough PLC meeting notes (may be messy, incomplete, or out of order). Please turn them into a clean, professional package.

If anything in the notes could identify a specific student (names, IDs, unique circumstances), replace with anonymized labels like "Student A" or describe at the group/pattern level only.

Output these sections in order:
1. **Clean Meeting Summary** (3-5 bullets, what happened and what mattered)
2. **Final Decisions** (numbered list, clear and definitive)
3. **Action Tracker** (table: Action | Owner | Due | Evidence of Completion)
4. **Follow-Up Email Draft** (ready to send to the team, warm-direct tone)

NOTES:
${notes}`;
}

app.post('/api/generate', async (req, res) => {
  const { mode, formData, notes } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let userMessage;
    if (mode === 'generate')      userMessage = buildGeneratePrompt(formData);
    else if (mode === 'facilitation') userMessage = buildFacilitationPrompt(formData);
    else if (mode === 'followthrough') userMessage = buildFollowThroughPrompt(notes);
    else return res.write('data: ' + JSON.stringify({ error: 'Unknown mode' }) + '\n\n');

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    stream.on('text', (text) => {
      res.write('data: ' + JSON.stringify({ text }) + '\n\n');
    });

    stream.on('error', (err) => {
      res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
      res.end();
    });

    stream.on('finalMessage', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (err) {
    res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    res.end();
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
    });
    stream.on('text',  (text) => res.write('data: ' + JSON.stringify({ text }) + '\n\n'));
    stream.on('error', (err)  => { res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n'); res.end(); });
    stream.on('finalMessage', () => { res.write('data: [DONE]\n\n'); res.end(); });
  } catch (err) {
    res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n  Admin AI Hub running at http://localhost:${PORT}\n`);
});
