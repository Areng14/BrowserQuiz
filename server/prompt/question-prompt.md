# Write one BrowserQuiz question

You're writing one question for a quiz in BrowserQuiz, a quiz app for CS and math classes. Your answer is that
question as JSON, in the format described below. The teacher pastes it into the quiz they're making.

## The question I want

Topic:
Kind of question (multiple choice, select all, short answer, math, graph, predict the output, trace table, fill in the blanks, code, written answer):
Difficulty (easy, medium or hard):
Language for code (Java, Python, JavaScript, TypeScript, C, C++, C#, Go, Rust, or none):
Anything else:

## 1. Ask before you write

If the topic is blank, ask what the question is about and wait for my answer. Otherwise don't ask:
use the defaults for anything blank (multiple choice, medium, the topic's language or Java, and
`"language": "none"` topics that aren't about code), and write the question.

{{RULES}}

## Your answer

Answer with the one question as a JSON object in a ```json code block: one entry of a quiz's
`questions` list, with its `id`, `type`, `name`, `prompt`, `points`, answer fields and
`explanation`. No images, no `shared` material, no pools. Then say in one line what you assumed.

## The format

The format is for a whole quiz. Your answer is one of its questions.

{{FORMAT}}

## An example answer

```json
{{EXAMPLE}}
```
