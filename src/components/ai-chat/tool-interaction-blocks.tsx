import {
  Check,
  ChevronDown,
  ChevronRight,
  ListTodo,
  MessageSquareText,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { memo, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TERMINAL_EXEC_TOOL_NAME } from "@/lib/ai-chat/terminal-tool";
import type {
  AgentTask,
  AskUserOption,
  AskUserQuestion,
  AskUserQuestionType,
  AskUserRequest,
  AskUserResponse,
  ChatToolCall,
  ChatToolResult,
  ToolApprovalRequest,
  ToolApprovalResponse,
  ToolExecutionStatus,
  UserInputStatus,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const ASK_USER_CUSTOM_ANSWER_ID = "__custom__";
const MAX_ASK_USER_CUSTOM_ANSWER_LENGTH = 2000;

function getAskUserQuestionType(
  question: AskUserQuestion,
): AskUserQuestionType {
  if (
    question.type === "multi_select" ||
    question.type === "text" ||
    question.type === "single_choice"
  ) {
    return question.type;
  }

  return "single_choice";
}

function createDefaultAskUserAnswers(request: AskUserRequest) {
  return Object.fromEntries(
    request.questions.map((question) => {
      const questionType = getAskUserQuestionType(question);
      if (questionType === "text" || questionType === "multi_select") {
        return [question.id, ""];
      }

      return [question.id, question.options[0]?.id ?? ""];
    }),
  );
}

function createDefaultAskUserMultiAnswers(request: AskUserRequest) {
  return Object.fromEntries(
    request.questions.map((question) => [question.id, [] as string[]]),
  );
}

function createEmptyAskUserCustomAnswers(request: AskUserRequest) {
  return Object.fromEntries(
    request.questions.map((question) => [question.id, ""]),
  );
}

function formatUserInputStatus(status: UserInputStatus | undefined) {
  if (status === "complete") return "Complete";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Failed";
  return "Waiting";
}

function formatToolApprovalHeaderStatus(
  status: UserInputStatus,
  response?: ToolApprovalResponse,
) {
  if (status === "waiting") return "Waiting";
  if (status === "complete") return response?.approved ? "Approved" : undefined;
  if (status === "failed") return "Failed";
  return undefined;
}

export const AskUserBlock = memo(function AskUserBlock({
  id,
  request,
  response,
  status,
  canSubmit,
  isCollapsed,
  onToggleCollapsed,
  onSubmit,
  onCancel,
  onLayoutChange,
}: {
  id: string;
  request: AskUserRequest;
  response?: AskUserResponse;
  status?: UserInputStatus;
  canSubmit: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onSubmit: (response: AskUserResponse) => void;
  onCancel: () => void;
  onLayoutChange?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    createDefaultAskUserAnswers(request),
  );
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>(
    () => createDefaultAskUserMultiAnswers(request),
  );
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(
    () => createEmptyAskUserCustomAnswers(request),
  );
  const effectiveStatus = status ?? "waiting";
  const isWaiting = effectiveStatus === "waiting";
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const activeQuestionCount = request.questions.length;
  const activeQuestion =
    request.questions[activeQuestionIndex] ?? request.questions[0];

  useEffect(() => {
    setAnswers(response?.answers ?? createDefaultAskUserAnswers(request));
    setMultiAnswers(
      response?.multiAnswers ?? createDefaultAskUserMultiAnswers(request),
    );
    setCustomAnswers(
      response?.customAnswers ?? createEmptyAskUserCustomAnswers(request),
    );
    setActiveQuestionIndex(0);
  }, [request, response]);

  useLayoutEffect(() => {
    onLayoutChange?.();
  }, [
    activeQuestionIndex,
    isCollapsed,
    effectiveStatus,
    response,
    onLayoutChange,
  ]);

  function getSelectedOptionLabel(questionId: string, optionId?: string) {
    const question = request.questions.find((item) => item.id === questionId);
    if (optionId === ASK_USER_CUSTOM_ANSWER_ID) {
      return (
        customAnswers[questionId]?.trim() ||
        response?.customAnswers?.[questionId]?.trim() ||
        "Type your answer"
      );
    }

    return (
      question?.options.find((option) => option.id === optionId)?.label ??
      optionId ??
      ""
    );
  }

  function getMultiAnswerLabels(
    question: AskUserQuestion,
    optionIds: string[],
  ) {
    return optionIds
      .map((optionId) => getSelectedOptionLabel(question.id, optionId))
      .filter(Boolean);
  }

  function getAnswerSummary(question: AskUserQuestion) {
    const questionType = getAskUserQuestionType(question);
    const responseLabel = response?.answerLabels?.[question.id];

    if (Array.isArray(responseLabel)) {
      return responseLabel.join(", ");
    }

    if (typeof responseLabel === "string" && responseLabel.trim()) {
      return responseLabel.trim();
    }

    if (questionType === "multi_select") {
      const selectedIds = response?.multiAnswers?.[question.id] ?? [];
      return getMultiAnswerLabels(question, selectedIds).join(", ");
    }

    if (questionType === "text") {
      return response?.answers[question.id] ?? answers[question.id] ?? "";
    }

    const selectedOptionId =
      response?.answers[question.id] ?? answers[question.id];
    if (selectedOptionId === ASK_USER_CUSTOM_ANSWER_ID) {
      return (
        response?.customAnswers?.[question.id] ??
        customAnswers[question.id] ??
        "Type your answer"
      );
    }

    return getSelectedOptionLabel(question.id, selectedOptionId);
  }

  function isQuestionAnswered(question: AskUserQuestion | undefined) {
    if (!question) return false;

    const questionType = getAskUserQuestionType(question);
    if (questionType === "text") {
      return Boolean(answers[question.id]?.trim());
    }

    if (questionType === "multi_select") {
      const selectedIds = multiAnswers[question.id] ?? [];
      return selectedIds.some((optionId) => {
        if (optionId !== ASK_USER_CUSTOM_ANSWER_ID) return true;
        return Boolean(customAnswers[question.id]?.trim());
      });
    }

    const selectedAnswer = answers[question.id];
    if (selectedAnswer === ASK_USER_CUSTOM_ANSWER_ID) {
      return Boolean(customAnswers[question.id]?.trim());
    }

    return question.options.some((option) => option.id === selectedAnswer);
  }

  const allQuestionsAnswered = request.questions.every((question) =>
    isQuestionAnswered(question),
  );
  const canSendAnswers = isWaiting && canSubmit && allQuestionsAnswered;

  function goToPreviousQuestion() {
    setActiveQuestionIndex((current) => Math.max(0, current - 1));
  }

  function goToNextQuestion() {
    if (!isQuestionAnswered(activeQuestion)) return;
    setActiveQuestionIndex((current) =>
      Math.min(activeQuestionCount - 1, current + 1),
    );
  }

  function advanceOrSubmitActiveQuestion() {
    if (!isQuestionAnswered(activeQuestion)) return;

    if (activeQuestionIndex < activeQuestionCount - 1) {
      goToNextQuestion();
      return;
    }

    handleSubmit();
  }

  function handleTextareaAnswerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;

    event.preventDefault();
    advanceOrSubmitActiveQuestion();
  }

  function renderCompletedAnswerList() {
    if (!response) return null;

    return (
      <div className="mt-2 grid gap-2 text-sm normal-case leading-5 tracking-normal">
        {request.questions.length > 0 && (
          <dl className="grid gap-2 text-sm leading-5 normal-case tracking-normal">
            {request.questions.map((question) => (
              <div key={question.id} className="grid">
                <dt className="font-medium text-muted-foreground">
                  <span className="font-normal">Q:</span> {question.question}
                </dt>
                <dd className="text-foreground/85">
                  <span className="font-normal">A:</span>{" "}
                  {getAnswerSummary(question)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  function renderTextAnswer(question: AskUserQuestion, readOnly = false) {
    const value = readOnly
      ? (response?.answers[question.id] ?? "")
      : (answers[question.id] ?? "");
    const updateAnswer = (nextValue: string) => {
      setAnswers((current) => ({
        ...current,
        [question.id]: nextValue.slice(0, MAX_ASK_USER_CUSTOM_ANSWER_LENGTH),
      }));
    };

    return (
      <Textarea
        value={value}
        disabled={readOnly || !canSubmit}
        readOnly={readOnly}
        maxLength={MAX_ASK_USER_CUSTOM_ANSWER_LENGTH}
        onChange={(event) => updateAnswer(event.target.value)}
        onKeyDown={handleTextareaAnswerKeyDown}
        className="min-h-24  text-sm"
      />
    );
  }

  function focusAdjacentChoiceOption(
    event: ReactKeyboardEvent<HTMLElement>,
    direction: -1 | 1,
  ) {
    const container = event.currentTarget.parentElement;
    if (!container) return;

    const optionElements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-ask-user-option]"),
    ).filter((element) => element.tabIndex >= 0);
    const currentIndex = optionElements.indexOf(event.currentTarget);
    if (currentIndex < 0 || optionElements.length === 0) return;

    event.preventDefault();

    const nextIndex =
      (currentIndex + direction + optionElements.length) %
      optionElements.length;
    optionElements[nextIndex]?.focus();
  }

  function handleChoiceOptionKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    onSelect?: () => void,
  ) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      focusAdjacentChoiceOption(event, 1);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      focusAdjacentChoiceOption(event, -1);
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    onSelect?.();
  }

  function renderChoiceOption({
    question,
    option,
    checked,
    inputType,
    inputId,
    inputName,
    readOnly = false,
    onChange,
  }: {
    question: AskUserQuestion;
    option: AskUserOption;
    checked: boolean;
    inputType: "radio" | "checkbox";
    inputId?: string;
    inputName?: string;
    readOnly?: boolean;
    onChange?: () => void;
  }) {
    const isInteractive = !readOnly && canSubmit;
    const choiceLabel = `${question.question}: ${option.label}`;

    return (
      <div
        key={option.id}
        role={inputType}
        aria-checked={checked}
        aria-label={choiceLabel}
        tabIndex={isInteractive ? 0 : -1}
        data-ask-user-option
        className={cn(
          "flex items-start gap-2  border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          checked
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border/70 bg-background/60",
          isInteractive && "cursor-pointer hover:bg-muted/60",
          !isInteractive && "cursor-default opacity-90",
        )}
        onClick={() => {
          if (!isInteractive) return;
          onChange?.();
        }}
        onKeyDown={(event) => handleChoiceOptionKeyDown(event, onChange)}
      >
        <input
          id={inputId}
          type={inputType}
          name={inputName}
          value={option.id}
          checked={checked}
          readOnly={readOnly}
          disabled={readOnly || !canSubmit}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          onChange={onChange}
          className="mt-1 size-3.5 shrink-0 accent-primary"
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium leading-5 text-foreground">
            {option.label}
          </span>
          {option.description?.trim() && (
            <span className="text-sm leading-5 text-muted-foreground">
              {option.description.trim()}
            </span>
          )}
        </span>
      </div>
    );
  }

  function renderCustomChoiceOption({
    question,
    checked,
    inputType,
    inputName,
    readOnly = false,
    onSelect,
  }: {
    question: AskUserQuestion;
    checked: boolean;
    inputType: "radio" | "checkbox";
    inputName?: string;
    readOnly?: boolean;
    onSelect?: () => void;
  }) {
    const customInputId = `${id}-${question.id}-custom-text`;
    const customAnswer = readOnly
      ? (response?.customAnswers?.[question.id] ?? "")
      : (customAnswers[question.id] ?? "");
    const isInteractive = !readOnly && canSubmit;
    const customDescription =
      readOnly && checked && customAnswer.trim()
        ? customAnswer.trim()
        : "Enter a custom answer instead of choosing one of the suggested options.";
    const choiceLabel = `${question.question}: Custom answer`;

    return (
      <div
        role={inputType}
        aria-checked={checked}
        aria-label={choiceLabel}
        tabIndex={isInteractive ? 0 : -1}
        data-ask-user-option
        className={cn(
          "grid gap-2  border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          checked
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border/70 bg-background/60",
          isInteractive && "cursor-pointer hover:bg-muted/60",
          !isInteractive && "cursor-default opacity-90",
        )}
        onClick={() => {
          if (!isInteractive) return;
          onSelect?.();
        }}
        onKeyDown={(event) => handleChoiceOptionKeyDown(event, onSelect)}
      >
        <span className="flex items-start gap-2">
          <input
            type={inputType}
            name={inputName}
            value={ASK_USER_CUSTOM_ANSWER_ID}
            checked={checked}
            readOnly={readOnly}
            disabled={readOnly || !canSubmit}
            onClick={(event) => event.stopPropagation()}
            onChange={onSelect}
            className="mt-1 size-3.5 shrink-0 accent-primary"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium leading-5 text-foreground">
              Type your answer
            </span>
            <span className="text-sm leading-5 text-muted-foreground">
              {customDescription}
            </span>
          </span>
        </span>
        {!readOnly && (
          <Textarea
            id={customInputId}
            value={customAnswer}
            onClick={(event) => event.stopPropagation()}
            onFocus={() => {
              if (!isInteractive) return;
              if (inputType === "radio") {
                setAnswers((current) => ({
                  ...current,
                  [question.id]: ASK_USER_CUSTOM_ANSWER_ID,
                }));
                return;
              }

              setMultiAnswers((current) => {
                const selectedIds = current[question.id] ?? [];
                return selectedIds.includes(ASK_USER_CUSTOM_ANSWER_ID)
                  ? current
                  : {
                      ...current,
                      [question.id]: [
                        ...selectedIds,
                        ASK_USER_CUSTOM_ANSWER_ID,
                      ],
                    };
              });
            }}
            onChange={(event) => {
              const nextValue = event.target.value.slice(
                0,
                MAX_ASK_USER_CUSTOM_ANSWER_LENGTH,
              );
              setCustomAnswers((current) => ({
                ...current,
                [question.id]: nextValue,
              }));

              if (inputType === "radio") {
                setAnswers((current) => ({
                  ...current,
                  [question.id]: ASK_USER_CUSTOM_ANSWER_ID,
                }));
                return;
              }

              setMultiAnswers((current) => {
                const selectedIds = current[question.id] ?? [];
                if (nextValue.trim()) {
                  return selectedIds.includes(ASK_USER_CUSTOM_ANSWER_ID)
                    ? current
                    : {
                        ...current,
                        [question.id]: [
                          ...selectedIds,
                          ASK_USER_CUSTOM_ANSWER_ID,
                        ],
                      };
                }

                return {
                  ...current,
                  [question.id]: selectedIds.filter(
                    (optionId) => optionId !== ASK_USER_CUSTOM_ANSWER_ID,
                  ),
                };
              });
            }}
            disabled={!canSubmit}
            maxLength={MAX_ASK_USER_CUSTOM_ANSWER_LENGTH}
            onKeyDown={(event) => {
              event.stopPropagation();
              handleTextareaAnswerKeyDown(event);
            }}
            className="min-h-20  text-sm"
          />
        )}
      </div>
    );
  }

  function renderQuestionInput(question: AskUserQuestion) {
    const questionType = getAskUserQuestionType(question);

    if (questionType === "text") {
      return renderTextAnswer(question);
    }

    if (questionType === "multi_select") {
      const selectedIds = multiAnswers[question.id] ?? [];
      return (
        <div className="grid gap-1.5">
          {question.options.map((option) => {
            const inputId = `${id}-${question.id}-${option.id}`;
            const checked = selectedIds.includes(option.id);

            return renderChoiceOption({
              question,
              option,
              checked,
              inputType: "checkbox",
              inputId,
              onChange: () => {
                setMultiAnswers((current) => {
                  const currentIds = current[question.id] ?? [];
                  return {
                    ...current,
                    [question.id]: currentIds.includes(option.id)
                      ? currentIds.filter((item) => item !== option.id)
                      : [...currentIds, option.id],
                  };
                });
              },
            });
          })}
          {renderCustomChoiceOption({
            question,
            checked: selectedIds.includes(ASK_USER_CUSTOM_ANSWER_ID),
            inputType: "checkbox",
            onSelect: () => {
              setMultiAnswers((current) => {
                const currentIds = current[question.id] ?? [];
                return {
                  ...current,
                  [question.id]: currentIds.includes(ASK_USER_CUSTOM_ANSWER_ID)
                    ? currentIds.filter(
                        (item) => item !== ASK_USER_CUSTOM_ANSWER_ID,
                      )
                    : [...currentIds, ASK_USER_CUSTOM_ANSWER_ID],
                };
              });
            },
          })}
        </div>
      );
    }

    const selectedOptionId = answers[question.id] ?? "";
    return (
      <div className="grid gap-1.5">
        {question.options.map((option) => {
          const inputId = `${id}-${question.id}-${option.id}`;
          const checked = selectedOptionId === option.id;

          return renderChoiceOption({
            question,
            option,
            checked,
            inputType: "radio",
            inputId,
            inputName: `${id}-${question.id}`,
            onChange: () =>
              setAnswers((current) => ({
                ...current,
                [question.id]: option.id,
              })),
          });
        })}
        {renderCustomChoiceOption({
          question,
          checked: selectedOptionId === ASK_USER_CUSTOM_ANSWER_ID,
          inputType: "radio",
          inputName: `${id}-${question.id}`,
          onSelect: () =>
            setAnswers((current) => ({
              ...current,
              [question.id]: ASK_USER_CUSTOM_ANSWER_ID,
            })),
        })}
      </div>
    );
  }

  function renderReadOnlyQuestion(question: AskUserQuestion) {
    if (!response) return null;

    const questionType = getAskUserQuestionType(question);

    return (
      <div key={question.id} className="grid gap-3">
        <div className="grid gap-1">
          <div className="text-base font-medium leading-6 text-foreground">
            {question.question}
          </div>
          {question.description?.trim() && (
            <div className="text-sm leading-5 text-muted-foreground">
              {question.description.trim()}
            </div>
          )}
        </div>

        {questionType === "text" ? (
          renderTextAnswer(question, true)
        ) : questionType === "multi_select" ? (
          <div className="grid gap-1.5">
            {question.options.map((option) => {
              const selectedIds = response.multiAnswers?.[question.id] ?? [];
              return renderChoiceOption({
                question,
                option,
                checked: selectedIds.includes(option.id),
                inputType: "checkbox",
                readOnly: true,
              });
            })}
            {renderCustomChoiceOption({
              question,
              checked: Boolean(
                response.multiAnswers?.[question.id]?.includes(
                  ASK_USER_CUSTOM_ANSWER_ID,
                ),
              ),
              inputType: "checkbox",
              readOnly: true,
            })}
          </div>
        ) : (
          <div className="grid gap-1.5">
            {question.options.map((option) =>
              renderChoiceOption({
                question,
                option,
                checked: response.answers[question.id] === option.id,
                inputType: "radio",
                readOnly: true,
              }),
            )}
            {renderCustomChoiceOption({
              question,
              checked:
                response.answers[question.id] === ASK_USER_CUSTOM_ANSWER_ID,
              inputType: "radio",
              readOnly: true,
            })}
          </div>
        )}
      </div>
    );
  }

  function handleSubmit() {
    if (!canSendAnswers) return;

    const normalizedAnswers = Object.fromEntries(
      request.questions.map((question) => {
        const questionType = getAskUserQuestionType(question);
        if (questionType === "multi_select") return [question.id, ""];
        return [question.id, answers[question.id] ?? ""];
      }),
    );
    const normalizedMultiAnswers = Object.fromEntries(
      request.questions
        .filter(
          (question) => getAskUserQuestionType(question) === "multi_select",
        )
        .map((question) => [
          question.id,
          (multiAnswers[question.id] ?? []).filter((optionId) => {
            if (optionId !== ASK_USER_CUSTOM_ANSWER_ID) return true;
            return Boolean(customAnswers[question.id]?.trim());
          }),
        ]),
    );
    const normalizedCustomAnswers = Object.fromEntries(
      request.questions
        .filter((question) => {
          const questionType = getAskUserQuestionType(question);
          if (questionType === "single_choice") {
            return answers[question.id] === ASK_USER_CUSTOM_ANSWER_ID;
          }
          if (questionType === "multi_select") {
            return (multiAnswers[question.id] ?? []).includes(
              ASK_USER_CUSTOM_ANSWER_ID,
            );
          }
          return false;
        })
        .map((question) => [question.id, customAnswers[question.id].trim()]),
    );
    const answerLabels = Object.fromEntries(
      request.questions.map((question) => {
        const questionType = getAskUserQuestionType(question);
        if (questionType === "text") {
          const value = answers[question.id]?.trim() ?? "";
          return [question.id, value];
        }
        if (questionType === "multi_select") {
          const selectedIds = normalizedMultiAnswers[question.id] ?? [];
          return [question.id, getMultiAnswerLabels(question, selectedIds)];
        }

        const selectedAnswer = answers[question.id];
        return [
          question.id,
          selectedAnswer === ASK_USER_CUSTOM_ANSWER_ID
            ? customAnswers[question.id].trim()
            : getSelectedOptionLabel(question.id, selectedAnswer),
        ];
      }),
    );

    onSubmit({
      answers: normalizedAnswers,
      multiAnswers:
        Object.keys(normalizedMultiAnswers).length > 0
          ? normalizedMultiAnswers
          : undefined,
      answerLabels,
      customAnswers:
        Object.keys(normalizedCustomAnswers).length > 0
          ? normalizedCustomAnswers
          : undefined,
      answeredAt: new Date().toISOString(),
    });
  }

  return (
    <article key={id} className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden  border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        <button
          type="button"
          className="w-full  text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <MessageSquareText className="size-3.5 shrink-0" />
              <span className="truncate">Ask user</span>
              <span className="text-muted-foreground/60">•</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  effectiveStatus === "complete" &&
                    "text-green-600 dark:text-green-400",
                  effectiveStatus === "waiting" &&
                    "text-amber-600 dark:text-amber-400",
                  (effectiveStatus === "cancelled" ||
                    effectiveStatus === "failed") &&
                    "text-red-600 dark:text-red-400",
                )}
              >
                {effectiveStatus === "complete" ? (
                  <Check className="size-3.5" />
                ) : effectiveStatus === "waiting" ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <X className="size-3.5" />
                )}
                {formatUserInputStatus(effectiveStatus)}
              </span>
              <span className="hidden text-muted-foreground/60 sm:inline">
                • {request.questions.length} question
                {request.questions.length === 1 ? "" : "s"}
              </span>
            </div>
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
          </div>
          {(request.title?.trim() || request.description?.trim()) && (
            <div className="mt-2 grid gap-1 text-sm normal-case leading-5 tracking-normal text-muted-foreground/85">
              {request.title?.trim() && (
                <div className="font-medium text-foreground/80">
                  {request.title.trim()}
                </div>
              )}
              {request.description?.trim() && (
                <div>{request.description.trim()}</div>
              )}
            </div>
          )}

          {isCollapsed &&
            response &&
            effectiveStatus !== "waiting" &&
            renderCompletedAnswerList()}
        </button>

        {!isCollapsed && (
          <div className="mt-3 grid gap-3">
            {isWaiting &&
              activeQuestion &&
              (() => {
                const question = activeQuestion;
                const currentQuestionAnswered = isQuestionAnswered(question);
                const isFirstQuestion = activeQuestionIndex === 0;
                const isLastQuestion =
                  activeQuestionIndex === activeQuestionCount - 1;

                return (
                  <div className="grid gap-3">
                    {activeQuestionCount > 1 && (
                      <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                        Question {activeQuestionIndex + 1} of{" "}
                        {activeQuestionCount}
                      </div>
                    )}

                    <div className="grid gap-1">
                      <div className="text-base font-medium leading-6 text-foreground">
                        {question.question}
                      </div>
                      {question.description?.trim() && (
                        <div className="text-sm leading-5 text-muted-foreground">
                          {question.description.trim()}
                        </div>
                      )}
                    </div>

                    {renderQuestionInput(question)}

                    {canSubmit && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className=""
                          onClick={onCancel}
                        >
                          Cancel
                        </Button>
                        <div className="flex flex-wrap justify-end gap-2">
                          {activeQuestionCount > 1 && !isFirstQuestion && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className=""
                              onClick={goToPreviousQuestion}
                            >
                              Back
                            </Button>
                          )}
                          {activeQuestionCount > 1 && !isLastQuestion ? (
                            <Button
                              type="button"
                              size="sm"
                              className=""
                              onClick={goToNextQuestion}
                              disabled={!currentQuestionAnswered}
                            >
                              Next
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              className=""
                              onClick={handleSubmit}
                              disabled={!canSendAnswers}
                            >
                              Submit answers
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

            {isWaiting && !canSubmit && (
              <div className=" border border-dashed bg-muted/30 px-3 py-2 text-sm leading-5 text-muted-foreground">
                This input request is no longer connected to an active
                generation. Regenerate the response to ask again.
              </div>
            )}

            {response && effectiveStatus !== "waiting" && (
              <div className="grid gap-3">
                <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
                  Selected answers
                </div>
                <div className="grid gap-6 text-sm leading-5">
                  {request.questions.map((question) =>
                    renderReadOnlyQuestion(question),
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
});

function renderTerminalTextBlock(value: string, emptyLabel = "No output yet.") {
  const text = value.length ? value : emptyLabel;

  return (
    <pre className="max-h-[min(22rem,45dvh)] overflow-auto border bg-background/80 px-3 py-2 font-mono text-xs leading-5 text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
      {text}
    </pre>
  );
}

function renderApprovalTerminalOutput(toolResult?: ChatToolResult) {
  const terminal = toolResult?.terminal;
  if (!terminal) {
    const content = toolResult?.content.trim();
    if (!content) return null;

    return (
      <div className="grid gap-1.5">
        <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
          Output
        </div>
        {renderTerminalTextBlock(content)}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {terminal.warnings?.length ? (
        <div className="grid gap-1 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {terminal.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
          Stdout
        </div>
        {renderTerminalTextBlock(terminal.stdout)}
      </div>
      <div className="grid gap-1.5">
        <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground/80">
          Stderr
        </div>
        {renderTerminalTextBlock(terminal.stderr)}
      </div>
      <div className="grid gap-1.5 text-xs text-muted-foreground">
        <div>
          Exit code: {terminal.exitCode === null ? "—" : terminal.exitCode} · Duration: {terminal.durationMs ? `${(terminal.durationMs / 1000).toFixed(1)}s` : "—"}
          {terminal.timedOut ? " · Timed out" : ""}
          {terminal.cancelled ? " · Cancelled" : ""}
          {terminal.outputTruncated ? " · Output truncated" : ""}
        </div>
        {terminal.cwd ? <div className="truncate">CWD: {terminal.cwd}</div> : null}
      </div>
    </div>
  );
}

export const ToolApprovalBlock = memo(function ToolApprovalBlock({
  id,
  request,
  response,
  toolResult,
  status,
  canSubmit,
  isCollapsed,
  onToggleCollapsed,
  onSubmit,
  onLayoutChange,
}: {
  id: string;
  request: ToolApprovalRequest;
  response?: ToolApprovalResponse;
  toolResult?: ChatToolResult;
  status?: UserInputStatus;
  canSubmit: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onSubmit: (response: ToolApprovalResponse) => void;
  onLayoutChange?: () => void;
}) {
  const effectiveStatus = status ?? "waiting";
  const isWaiting = effectiveStatus === "waiting";

  useLayoutEffect(() => {
    onLayoutChange?.();
  }, [effectiveStatus, isCollapsed, onLayoutChange, response, toolResult]);

  function submitApproval(approved: boolean) {
    if (!canSubmit || !isWaiting) return;
    onSubmit({ approved, answeredAt: new Date().toISOString() });
  }

  const approvalStatusText = formatToolApprovalHeaderStatus(
    effectiveStatus,
    response,
  );

  return (
    <article key={id} className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden  border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        <button
          type="button"
          className="w-full  text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="size-3.5 shrink-0" />
              <span className="truncate">Approval</span>
              {approvalStatusText && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      effectiveStatus === "complete" &&
                        "text-green-600 dark:text-green-400",
                      effectiveStatus === "waiting" &&
                        "text-amber-600 dark:text-amber-400",
                      effectiveStatus === "failed" &&
                        "text-red-600 dark:text-red-400",
                    )}
                  >
                    {effectiveStatus === "complete" ? (
                      <Check className="size-3.5" />
                    ) : effectiveStatus === "waiting" ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                    {approvalStatusText}
                  </span>
                </>
              )}
              <span className="text-muted-foreground/60">•</span>
              <span className="truncate font-mono normal-case tracking-normal text-muted-foreground/80">
                {request.toolName}
              </span>
            </div>
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
          </div>
        </button>

        {!isCollapsed && (
          <div className="mt-3 grid gap-3">
            <div className="grid gap-1.5 text-sm leading-5 text-muted-foreground/85">
              {request.description?.trim() && (
                <div>{request.description.trim()}</div>
              )}
              {request.path?.trim() && (
                <div className="min-w-0 text-sm">
                  <span className="text-muted-foreground">Target: </span>
                  <span className="font-mono text-muted-foreground/85 [overflow-wrap:anywhere]">
                    {request.path}
                  </span>
                </div>
              )}
              {request.details?.length ? (
                <div className="grid gap-1 text-sm">
                  {request.details.map((detail) => (
                    <div key={detail.label} className="min-w-0">
                      <span className="text-muted-foreground">
                        {detail.label}:{" "}
                      </span>
                      <span className="text-muted-foreground/85 [overflow-wrap:anywhere]">
                        {detail.value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {isWaiting && canSubmit && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className=""
                  onClick={() => submitApproval(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className=""
                  onClick={() => submitApproval(true)}
                >
                  Approve
                </Button>
              </div>
            )}

            {isWaiting && !canSubmit && (
              <div className=" border border-dashed bg-muted/30 px-3 py-2 text-sm leading-5 text-muted-foreground">
                This approval request is no longer connected to an active
                generation. Regenerate the response to ask again.
              </div>
            )}

            {response && effectiveStatus !== "waiting" && (
              <div className="text-sm leading-5 text-muted-foreground">
                Operation {response.approved ? "approved" : "cancelled"}.
              </div>
            )}

            {request.toolName === TERMINAL_EXEC_TOOL_NAME
              ? renderApprovalTerminalOutput(toolResult)
              : null}
          </div>
        )}
      </div>
    </article>
  );
});

function getTaskItemIcon(done: boolean) {
  if (done) {
    return <Check className="size-3.5 text-green-600 dark:text-green-400" />;
  }

  return <Square className="size-3.5 text-muted-foreground/70" />;
}

function parseTaskToolResult(toolResult?: ChatToolResult): AgentTask[] {
  if (!toolResult?.content || toolResult.isError) return [];

  try {
    const parsed = JSON.parse(toolResult.content) as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return [];

    return parsed.tasks.filter((task): task is AgentTask => {
      if (!task || typeof task !== "object" || Array.isArray(task))
        return false;
      const source = task as Record<string, unknown>;
      return (
        typeof source.subject === "string" && typeof source.done === "boolean"
      );
    });
  } catch {
    return [];
  }
}

export const TaskListBlock = memo(function TaskListBlock({
  id,
  toolCall,
  toolResult,
  status,
  isCollapsed,
  onToggleCollapsed,
  onLayoutChange,
}: {
  id: string;
  toolCall: ChatToolCall;
  toolResult?: ChatToolResult;
  status?: ToolExecutionStatus;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onLayoutChange?: () => void;
}) {
  const tasks = useMemo(() => parseTaskToolResult(toolResult), [toolResult]);
  const totalCount = tasks.length;
  const doneCount = tasks.filter((task) => task.done).length;
  const isPending = !toolResult && status !== "complete" && status !== "failed";
  const isError = toolResult?.isError === true || status === "failed";

  useLayoutEffect(() => {
    onLayoutChange?.();
  }, [
    doneCount,
    isCollapsed,
    isError,
    isPending,
    onLayoutChange,
    tasks,
    totalCount,
  ]);

  return (
    <article key={id} className="flex min-w-0 max-w-full justify-start">
      <div className="w-full min-w-0 max-w-full overflow-hidden  border bg-muted/25 px-4 py-3 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        <button
          type="button"
          className="w-full  text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <ListTodo className="size-3.5 shrink-0" />
              <span className="truncate">Tasks</span>
              <span className="text-muted-foreground/60">•</span>
              <span className="text-muted-foreground/80">
                {isPending
                  ? "updating"
                  : isError
                    ? "failed"
                    : totalCount === 0
                      ? "none"
                      : `${doneCount}/${totalCount} done`}
              </span>
            </div>
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
          </div>
        </button>

        {!isCollapsed && (
          <div className="mt-3">
            {isPending ? (
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm leading-5 text-muted-foreground">
                <Spinner className="size-3.5" />
                <span>Updating tasks…</span>
              </div>
            ) : isError ? (
              <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive">
                {toolResult?.content || "Task tool failed."}
              </div>
            ) : totalCount === 0 ? (
              <div className="px-2 py-1.5 text-sm leading-5 text-muted-foreground">
                No active tasks.
              </div>
            ) : (
              <ul className="grid gap-0 text-sm normal-case leading-5 tracking-normal">
                {tasks.map((task, index) => (
                  <li
                    key={`${task.subject}-${index}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2  px-2 py-1.5"
                  >
                    <span className="mt-0.5">{getTaskItemIcon(task.done)}</span>
                    <div
                      className={cn(
                        "min-w-0 font-medium text-foreground/85",
                        task.done &&
                          "text-muted-foreground line-through decoration-muted-foreground/50",
                      )}
                    >
                      {task.subject}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
