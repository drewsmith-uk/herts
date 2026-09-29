import { useState } from 'react';
import { useUpdatePreparation } from './updateSafety';

type Question = { qid: string; question: string; choices?: string[]; multi_select?: boolean };
export function Clarification({ question, disabled, onAnswer }: {
  question: { question?: string; prompt?: string; choices?: string[]; multi_select?: boolean; questions?: Question[]; answers?: Record<string, string> };
  disabled: boolean; onAnswer: (text?: string, answers?: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const batch = !!question.questions?.length;
  const questions = batch ? question.questions! : [{ ...question, qid: 'answer', question: question.question || question.prompt || 'Hermes has a question.' }];
  const answers = { ...draft, ...question.answers };
  const locked = (id: string) => Object.hasOwn(question.answers || {}, id);
  function choose(q: Question, choice: string) {
    const prior = selected[q.qid] || [];
    const next = q.multi_select ? (prior.includes(choice) ? prior.filter(x => x !== choice) : [...prior, choice]) : [choice];
    setSelected(old => ({ ...old, [q.qid]: next }));
    setDraft(old => ({ ...old, [q.qid]: next.join(', ') }));
  }
  useUpdatePreparation({ blocked: () => Object.values(draft).some(Boolean) ? 'Send or clear your answers to Hermes before updating.' : undefined });
  return <form className="clarify-form" onSubmit={event => { event.preventDefault(); if (!disabled) batch ? onAnswer(undefined, answers) : onAnswer(answers.answer); }}>
    {questions.map(q => <fieldset key={q.qid} disabled={disabled || locked(q.qid)}>
      <legend>{q.question}</legend>
      {!!q.choices?.length && <div className="button-row">{q.choices.map(choice => <button type="button" key={choice} aria-pressed={q.multi_select ? (selected[q.qid] || []).includes(choice) : answers[q.qid] === choice} onClick={() => choose(q, choice)}>{choice}</button>)}</div>}
      <input aria-label={batch ? `Answer: ${q.question}` : 'Answer Hermes'} value={answers[q.qid] || ''} onChange={event => { setDraft(old => ({ ...old, [q.qid]: event.target.value })); setSelected(old => ({ ...old, [q.qid]: [] })); }}/>
      {locked(q.qid) && <p className="subtle-note">Answer already confirmed.</p>}
    </fieldset>)}
    <button disabled={disabled || questions.some(q => !locked(q.qid) && !answers[q.qid]?.trim())}>{batch ? 'Send answers' : 'Send answer'}</button>
  </form>;
}
