import { z } from 'zod';
import { topicInputSchema, topicOutputSchema, questionOutputSchema } from '../shared/practice.js';
import { reviewSchema } from '../shared/reports.js';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('next') }),
  z.object({ action: z.literal('retry'), index: z.number().int().min(0).max(2) }),
  z.object({ action: z.literal('finish') }),
]);
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

export function registerPracticeRoutes(app, { provider, limited, requireSession }) {
  app.post('/api/topics', async (request, reply) => {
    limited(request, 'topics', 3);
    const input = topicInputSchema.parse(request.body);
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    return topicOutputSchema.parse(
      await provider.practicePrompt('topic', input, controller.signal),
    );
  });
  app.post('/api/sessions/:id/interview', async (request) => {
    const s = requireSession(request);
    const action = actionSchema.parse(request.body);
    if (s.practice.mode !== 'interview') throw conflict('This session is not an interview.');
    if (s.status === 'processing' || s.interviewBusy)
      throw conflict('Wait for the current review.');
    limited(request, 'interview', 8);
    s.interviewBusy = true;
    try {
      const interview = s.interview || { turns: [], index: -1, question: null };
      const turns = interview.turns.slice();
      if (interview.index >= 0 && s.transcript && s.report.stages.audio) {
        turns[interview.index] = {
          question: interview.question,
          transcript: s.transcript.text,
          review: s.report.stages.audio,
        };
      }
      if (action.action === 'finish') {
        if (!turns.filter(Boolean).length) throw conflict('Review an answer before finishing.');
        const summary = reviewSchema.parse(
          await provider.review(
            'interview',
            { turns: turns.filter(Boolean), evidence: [] },
            [],
            s.abort.signal,
          ),
        );
        s.abort.signal.throwIfAborted();
        s.interview = { ...interview, turns, summary };
        return { ...s.interview, total: 3 };
      }
      const retry = action.action === 'retry';
      const index = retry ? action.index : interview.index + 1;
      if (retry && !turns[index]) throw conflict('Only completed answers can be retried.');
      if (!retry && interview.index >= 0 && (!s.transcript || !s.report.stages.audio))
        throw conflict('Finish and review this answer first.');
      if (index >= 3) throw conflict('Your three questions are complete. Review the interview.');
      const question = retry
        ? turns[index].question
        : questionOutputSchema.parse(
            await provider.practicePrompt(
              'question',
              { ...s.practice, turns: turns.slice(0, index), number: index + 1 },
              s.abort.signal,
            ),
          ).question;
      s.abort.signal.throwIfAborted();
      // Only commit after the provider succeeds. A failed follow-up keeps the last review intact.
      s.interview = { turns, index, question, summary: null };
      s.status = 'idle';
      s.report = { stages: {}, score: null };
      s.transcript = null;
      s.error = null;
      s.jobId = null;
      s.messages = [];
      return { ...s.interview, total: 3 };
    } finally {
      s.interviewBusy = false;
    }
  });
}
