import { writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<Array<{ id: string, text: string, category: string }>>} */
export const questions = writable([]);

/** @type {import('svelte/store').Writable<string | null>} */
export const sessionId = writable(null);

export const currentQuestionIndex = writable(0);

/** @type {import('svelte/store').Writable<Record<string, string>>} */
export const liveResponses = writable({});

/** @type {import('svelte/store').Writable<Record<string, Record<string, number>>>} */
export const scoresByQuestion = writable({});

export function setQuestions(list, sid = null) {
  questions.set(list);
  if (sid) sessionId.set(sid);
  currentQuestionIndex.set(0);
  liveResponses.set({});
  scoresByQuestion.set({});
}

export function resetRound() {
  liveResponses.set({});
  scoresByQuestion.set({});
}

export function appendLiveResponse(role, chunk) {
  liveResponses.update((m) => ({
    ...m,
    [role]: (m[role] || '') + chunk
  }));
}

export function mergeScores(questionId, scores) {
  scoresByQuestion.update((m) => ({ ...m, [questionId]: { ...scores } }));
}
