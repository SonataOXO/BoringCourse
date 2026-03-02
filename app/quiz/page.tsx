"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, CheckCircle2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getCanvasAuthHeaders } from "@/lib/client/canvas-auth";
import { appendHistory, getHistoryItemById } from "@/lib/client/history";

type Course = {
  id: number;
  name: string;
};

type AssignmentItem = {
  id: number;
  name: string;
  dueAt: string | null;
  conceptHint?: string;
};

type UploadedMaterial = {
  title: string;
  content: string;
};

type PersistedDashboardState = {
  courses: Course[];
  assignmentCache?: Record<number, AssignmentItem[]>;
  uploadedMaterials?: UploadedMaterial[];
};

type QuizQuestion = {
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
};

type LocalDocMaterial = {
  title: string;
  content: string;
};

type LocalImage = {
  name: string;
  dataUrl: string;
};

type QuizChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

const DASHBOARD_STORAGE_KEY = "boringcourse-dashboard-v1";
const TUTOR_HANDOFF_KEY = "boringcourse-tutor-handoff-v1";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid image data"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

function normalizeQuestions(items: unknown): QuizQuestion[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      const row = item as Record<string, unknown>;
      const prompt = String(row.prompt ?? "").trim();
      const options = Array.isArray(row.options)
        ? row.options.map((option) => String(option ?? "").trim()).filter(Boolean).slice(0, 4)
        : [];
      const answer = String(row.answer ?? "").trim();
      const explanation = String(row.explanation ?? "").trim();
      return { prompt, options, answer, explanation };
    })
    .filter((item) => item.prompt.length > 0 && item.options.length === 4 && item.answer.length > 0);
}

function scoreToLetterGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export default function QuizPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [dashboardState, setDashboardState] = useState<PersistedDashboardState>({
    courses: [],
    assignmentCache: {},
    uploadedMaterials: [],
  });

  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [courseAssignments, setCourseAssignments] = useState<AssignmentItem[]>([]);
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [selectedAssignments, setSelectedAssignments] = useState<AssignmentItem[]>([]);

  const [topicInput, setTopicInput] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [questionCount, setQuestionCount] = useState(8);

  const [docMaterials, setDocMaterials] = useState<LocalDocMaterial[]>([]);
  const [images, setImages] = useState<LocalImage[]>([]);
  const [uploadMessage, setUploadMessage] = useState("No files added yet.");

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<QuizChatMessage[]>([]);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [submittedResults, setSubmittedResults] = useState<Record<number, { correct: boolean }>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as PersistedDashboardState;
      const normalized: PersistedDashboardState = {
        courses: parsed.courses ?? [],
        assignmentCache: parsed.assignmentCache ?? {},
        uploadedMaterials: parsed.uploadedMaterials ?? [],
      };
      setDashboardState(normalized);

      const firstCourseId = normalized.courses[0]?.id ?? null;
      setSelectedCourseId(firstCourseId);
      if (firstCourseId) {
        setCourseAssignments(normalized.assignmentCache?.[firstCourseId] ?? []);
      }
    } catch {
      // Ignore malformed local data.
    }
  }, []);

  async function loadAssignmentsForCourse(courseId: number) {
    setError("");

    const cached = dashboardState.assignmentCache?.[courseId];
    if (cached && cached.length > 0) {
      setCourseAssignments(cached);
      return;
    }

    try {
      const response = await fetch(`/api/canvas/courses/${courseId}/assignments`, {
        headers: getCanvasAuthHeaders(),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to load assignments");
      }

      const mapped = ((json.assignments ?? []) as Array<Record<string, unknown>>).map((item) => ({
        id: Number(item.id),
        name: String(item.name ?? "Assignment"),
        dueAt: (item.dueAt as string | null | undefined) ?? null,
        conceptHint: (item.conceptHint as string | undefined) ?? undefined,
      }));

      setCourseAssignments(mapped);
      setDashboardState((prev) => ({
        ...prev,
        assignmentCache: { ...(prev.assignmentCache ?? {}), [courseId]: mapped },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assignments");
    }
  }

  const filteredAssignments = useMemo(() => {
    const query = assignmentSearch.trim().toLowerCase();
    if (!query) {
      return courseAssignments.slice(0, 40);
    }

    return courseAssignments.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 40);
  }, [assignmentSearch, courseAssignments]);

  function addSelectedAssignment() {
    const query = assignmentSearch.trim().toLowerCase();
    const target = filteredAssignments.find((item) => item.name.toLowerCase() === query) ?? filteredAssignments[0];
    if (!target) {
      return;
    }

    setSelectedAssignments((prev) => {
      if (prev.some((item) => item.id === target.id && item.name === target.name)) {
        return prev;
      }
      return [...prev, target];
    });
    setAssignmentSearch("");
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setError("");
    setUploadMessage("Processing files...");

    try {
      const docAdds: LocalDocMaterial[] = [];
      const imageAdds: LocalImage[] = [];

      for (const file of files) {
        if (file.type.startsWith("image/")) {
          const dataUrl = await fileToDataUrl(file);
          imageAdds.push({ name: file.name, dataUrl });
          continue;
        }

        const formData = new FormData();
        formData.set("file", file);
        formData.set("assignmentTitle", selectedAssignments[0]?.name ?? file.name);

        const response = await fetch("/api/upload/parse", {
          method: "POST",
          body: formData,
        });

        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error ?? `Failed to parse ${file.name}`);
        }

        docAdds.push({
          title: String(json.fileName ?? file.name),
          content: String(json.content ?? ""),
        });
      }

      if (imageAdds.length > 0) {
        setImages((prev) => [...prev, ...imageAdds].slice(0, 5));
      }
      if (docAdds.length > 0) {
        setDocMaterials((prev) => [...prev, ...docAdds].slice(0, 8));
      }

      setUploadMessage(`Added ${docAdds.length} document(s) and ${imageAdds.length} image(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process files");
      setUploadMessage("File upload failed.");
    } finally {
      event.target.value = "";
    }
  }

  async function generateQuiz(options?: { instruction?: string }) {
    setError("");
    setLoading(true);

    try {
      const selectedCourseName = dashboardState.courses.find((course) => course.id === selectedCourseId)?.name ?? "General";
      const selectedAssignmentLine = selectedAssignments.length > 0
        ? `Selected assignments: ${selectedAssignments.map((item) => item.name).join("; ")}`
        : "";
      const docsLine = docMaterials
        .map((item) => `${item.title}: ${item.content.slice(0, 5000)}`)
        .join("\n\n");
      const dashboardUploads = (dashboardState.uploadedMaterials ?? [])
        .slice(0, 4)
        .map((item) => `${item.title}: ${item.content.slice(0, 1500)}`)
        .join("\n\n");
      const chatContext = chatMessages.slice(-8).map((item) => `${item.role === "user" ? "User" : "AI"}: ${item.content}`).join("\n");

      const content = [
        topicInput.trim() ? `Quiz goal/topic: ${topicInput.trim()}` : "",
        selectedAssignmentLine,
        docsLine ? `Uploaded materials:\n${docsLine}` : "",
        dashboardUploads ? `Dashboard uploads:\n${dashboardUploads}` : "",
        chatContext ? `Chat direction:\n${chatContext}` : "",
        options?.instruction ? `Latest request: ${options.instruction}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const response = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: selectedCourseName,
          content: (content || "Core concepts and assignment topics.").slice(0, 12000),
          count: Math.max(1, Math.min(20, Number(questionCount))),
          difficulty,
          images: images.map((image) => image.dataUrl),
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to generate quiz");
      }

      const generated = normalizeQuestions(json.questions);
      if (generated.length === 0) {
        throw new Error("No quiz questions were generated.");
      }

      setQuestions(generated);
      setSelectedAnswers({});
      setSubmittedResults({});

      appendHistory({
        type: "quiz",
        title: "Quiz generated",
        summary: `${generated.length} questions • ${selectedCourseName}`,
        path: "/quiz",
        state: {
          selectedCourseId,
          selectedAssignments: selectedAssignments.map((item) => ({ id: item.id, name: item.name })),
          topicInput,
          difficulty,
          questionCount,
          questions: generated,
          chatMessages,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate quiz");
    } finally {
      setLoading(false);
    }
  }

  async function sendQuizChat() {
    const prompt = chatInput.trim();
    if (!prompt) {
      return;
    }

    const nextMessages = [...chatMessages, { role: "user" as const, content: prompt, createdAt: Date.now() }];
    setChatMessages(nextMessages);
    setChatInput("");

    await generateQuiz({ instruction: prompt });

    setChatMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "Quiz updated with your request.",
        createdAt: Date.now(),
      },
    ]);
  }

  function submitAnswer(questionIndex: number) {
    const selected = selectedAnswers[questionIndex];
    if (!selected || !questions[questionIndex]) {
      return;
    }

    const correct = selected === questions[questionIndex].answer;
    setSubmittedResults((prev) => ({ ...prev, [questionIndex]: { correct } }));
  }

  function clearQuizBuilder() {
    setTopicInput("");
    setSelectedAssignments([]);
    setDocMaterials([]);
    setImages([]);
    setUploadMessage("No files added yet.");
    setChatMessages([]);
    setChatInput("");
    setQuestions([]);
    setSelectedAnswers({});
    setSubmittedResults({});
    setError("");
  }

  useEffect(() => {
    const historyId = new URLSearchParams(window.location.search).get("historyId");
    if (!historyId) {
      return;
    }

    const historyItem = getHistoryItemById(historyId);
    if (!historyItem || historyItem.type !== "quiz" || !historyItem.state) {
      return;
    }

    const state = historyItem.state as {
      selectedCourseId?: number;
      selectedAssignments?: Array<{ id: number; name: string }>;
      topicInput?: string;
      difficulty?: "easy" | "medium" | "hard";
      questionCount?: number;
      questions?: QuizQuestion[];
      chatMessages?: QuizChatMessage[];
    };

    if (typeof state.selectedCourseId === "number") {
      setSelectedCourseId(state.selectedCourseId);
      setCourseAssignments(dashboardState.assignmentCache?.[state.selectedCourseId] ?? []);
    }

    if (Array.isArray(state.selectedAssignments) && state.selectedAssignments.length > 0) {
      const allAssignments = Object.values(dashboardState.assignmentCache ?? {}).flat();
      const restoredAssignments = state.selectedAssignments
        .map((saved) => allAssignments.find((item) => item.id === saved.id && item.name === saved.name))
        .filter(Boolean) as AssignmentItem[];
      if (restoredAssignments.length > 0) {
        setSelectedAssignments(restoredAssignments);
      }
    }

    if (typeof state.topicInput === "string") {
      setTopicInput(state.topicInput);
    }
    if (state.difficulty === "easy" || state.difficulty === "medium" || state.difficulty === "hard") {
      setDifficulty(state.difficulty);
    }
    if (typeof state.questionCount === "number") {
      setQuestionCount(Math.max(1, Math.min(20, state.questionCount)));
    }
    if (Array.isArray(state.questions)) {
      setQuestions(normalizeQuestions(state.questions));
    }
    if (Array.isArray(state.chatMessages)) {
      setChatMessages(state.chatMessages);
    }
  }, [dashboardState.assignmentCache]);

  const answeredCount = useMemo(() => Object.keys(submittedResults).length, [submittedResults]);
  const correctCount = useMemo(
    () => Object.values(submittedResults).filter((result) => result.correct).length,
    [submittedResults],
  );
  const quizCompleted = questions.length > 0 && answeredCount === questions.length;
  const percentScore = useMemo(() => {
    if (!quizCompleted || questions.length === 0) {
      return 0;
    }
    return Math.round((correctCount / questions.length) * 100);
  }, [correctCount, questions.length, quizCompleted]);
  const letterGrade = useMemo(() => scoreToLetterGrade(percentScore), [percentScore]);
  const missedQuestions = useMemo(
    () =>
      questions
        .map((question, index) => ({ question, index }))
        .filter(({ index }) => submittedResults[index] && !submittedResults[index].correct),
    [questions, submittedResults],
  );

  const circleRadius = 48;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circleOffset = circleCircumference * (1 - percentScore / 100);

  function openTutorForQuizReview() {
    if (!quizCompleted) {
      return;
    }

    const selectedCourseName = dashboardState.courses.find((course) => course.id === selectedCourseId)?.name ?? "General";
    const missedSummary =
      missedQuestions.length > 0
        ? missedQuestions
            .map(({ question, index }) => {
              const selected = selectedAnswers[index] ?? "No answer selected";
              return [
                `Q${index + 1}: ${question.prompt}`,
                `Your answer: ${selected}`,
                `Correct answer: ${question.answer}`,
                `Explanation: ${question.explanation}`,
              ].join("\n");
            })
            .join("\n\n")
        : "No missed questions. Student wants higher-difficulty reinforcement.";

    const payload = {
      source: "quiz",
      subject: selectedCourseName,
      question:
        missedQuestions.length > 0
          ? "Tutor me on the quiz questions I missed and show how to solve similar problems."
          : "I got all quiz questions right. Give me harder follow-up tutoring and challenge problems.",
      context: [
        `Quiz result: ${correctCount}/${questions.length} (${percentScore}%, ${letterGrade})`,
        `Difficulty: ${difficulty}`,
        topicInput.trim() ? `Quiz topic request: ${topicInput.trim()}` : "",
        `Missed question review:\n${missedSummary}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };

    window.localStorage.setItem(TUTOR_HANDOFF_KEY, JSON.stringify(payload));
    router.push("/tutor?from=quiz&autostart=1");
  }

  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="size-4" /> Back to Dashboard
          </Link>
        </Button>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-4" /> Quiz Builder</CardTitle>
              <CardDescription>Build quizzes with assignments, uploaded files, images, and chat instructions.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void generateQuiz()} disabled={loading}>
                {loading ? "Generating Quiz..." : "Generate Quiz"}
              </Button>
              <Button type="button" variant="secondary" onClick={clearQuizBuilder}>
                Clear
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select
              value={selectedCourseId ?? ""}
              onChange={(event) => {
                const raw = event.target.value;
                if (!raw) {
                  setSelectedCourseId(null);
                  setCourseAssignments([]);
                  return;
                }

                const courseId = Number(raw);
                setSelectedCourseId(courseId);
                void loadAssignmentsForCourse(courseId);
              }}
              className="h-10 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select course</option>
              {dashboardState.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <input
                value={assignmentSearch}
                onChange={(event) => setAssignmentSearch(event.target.value)}
                list="quiz-assignment-list"
                placeholder="Search assignment"
                className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="button" variant="secondary" onClick={addSelectedAssignment}>
                Add
              </Button>
              <datalist id="quiz-assignment-list">
                {filteredAssignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.name} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Selected Assignments</p>
              <div className="mt-2 space-y-2">
                {selectedAssignments.length > 0 ? selectedAssignments.map((item) => (
                  <div key={`${item.id}-${item.name}`} className="flex items-center justify-between rounded-xl border bg-background/70 p-2 text-sm">
                    <span className="truncate">{item.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedAssignments((prev) => prev.filter((assignment) => !(assignment.id === item.id && assignment.name === item.name)))
                      }
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No assignments selected yet.</p>}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quiz Settings</p>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as "easy" | "medium" | "hard")}
                  className="h-10 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={questionCount}
                  onChange={(event) => setQuestionCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                  className="h-10 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">What should the quiz be about?</p>
            <textarea
              value={topicInput}
              onChange={(event) => setTopicInput(event.target.value)}
              placeholder="Example: Unit 6 stoichiometry, include balancing, limiting reactant, and dimensional analysis"
              className="mt-2 h-24 w-full rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="mt-3 rounded-2xl border bg-background/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Media</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.txt,.md,.pdf,.docx"
                onChange={handleFiles}
                className="hidden"
              />
              <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" /> Add Images / Docs / PDF
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{uploadMessage}</p>
            {(docMaterials.length > 0 || images.length > 0) ? (
              <p className="mt-1 text-xs text-muted-foreground">Files loaded: {docMaterials.length} document(s), {images.length} image(s)</p>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border bg-background/70 p-4">
            <p className="text-sm font-semibold">Chat With AI Quiz Builder</p>
            <p className="mt-1 text-xs text-muted-foreground">Send an instruction to regenerate quiz style/content instantly.</p>
            <div className="mt-3 space-y-2">
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Example: Make more conceptual questions and fewer calculation questions"
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="button" onClick={() => void sendQuizChat()} disabled={loading || !chatInput.trim()} className="w-full">
                {loading ? "Updating Quiz..." : "Send + Update Quiz"}
              </Button>
            </div>
            <div className="mt-3 max-h-44 space-y-2 overflow-y-auto text-xs">
              {chatMessages.length > 0 ? (
                chatMessages.slice(-8).map((message) => (
                  <p key={`${message.createdAt}-${message.role}`} className={message.role === "user" ? "font-semibold" : "text-muted-foreground"}>
                    {message.role === "user" ? "You: " : "AI: "}
                    {message.content}
                  </p>
                ))
              ) : (
                <p className="text-muted-foreground">No quiz chat messages yet.</p>
              )}
            </div>
          </div>

          {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Live Quiz</CardTitle>
              <CardDescription>Pick an answer, submit, and get instant correctness feedback.</CardDescription>
            </div>
            <p className="text-sm font-semibold">
              Score: {correctCount} / {answeredCount}
            </p>
          </div>

          <div className="mt-4 space-y-4">
            {questions.length > 0 ? questions.map((question, questionIndex) => {
              const selected = selectedAnswers[questionIndex] ?? "";
              const submitted = submittedResults[questionIndex];
              return (
                <div key={`${question.prompt}-${questionIndex}`} className="rounded-2xl border bg-background/60 p-4">
                  <p className="font-semibold">{questionIndex + 1}. {question.prompt}</p>
                  <div className="mt-3 space-y-2">
                    {question.options.map((option) => {
                      const isSelected = selected === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            setSelectedAnswers((prev) => ({ ...prev, [questionIndex]: option }));
                            setSubmittedResults((prev) => {
                              if (!prev[questionIndex]) {
                                return prev;
                              }
                              const next = { ...prev };
                              delete next[questionIndex];
                              return next;
                            });
                          }}
                          className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${isSelected ? "border-accent bg-muted" : "bg-background hover:border-accent/50"}`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => submitAnswer(questionIndex)} disabled={!selected}>
                      Submit Answer
                    </Button>
                    {submitted ? (
                      <p className={`text-sm font-semibold ${submitted.correct ? "text-green-600" : "text-red-600"}`}>
                        {submitted.correct ? "Correct" : "Incorrect"}
                      </p>
                    ) : null}
                  </div>

                  {submitted && !submitted.correct ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Correct answer: {question.answer}
                    </p>
                  ) : null}
                  {submitted ? <p className="mt-1 text-xs text-muted-foreground">{question.explanation}</p> : null}
                </div>
              );
            }) : (
              <p className="text-sm text-muted-foreground">No quiz yet. Use Quiz Builder and click Generate Quiz.</p>
            )}
          </div>
        </Card>

        {quizCompleted ? (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <CardTitle>Quiz Results</CardTitle>
                <CardDescription>
                  Final score: {correctCount}/{questions.length} ({percentScore}%) • Grade {letterGrade}
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative h-28 w-28">
                  <svg viewBox="0 0 120 120" className="-rotate-90 h-28 w-28">
                    <circle cx="60" cy="60" r={circleRadius} stroke="currentColor" strokeWidth="10" className="text-muted/60 fill-none" />
                    <circle
                      cx="60"
                      cy="60"
                      r={circleRadius}
                      stroke="currentColor"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={circleCircumference}
                      strokeDashoffset={circleOffset}
                      className="text-accent fill-none transition-all duration-500"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-lg font-semibold">{percentScore}%</p>
                    <p className="text-xs text-muted-foreground">Grade {letterGrade}</p>
                  </div>
                </div>
                <Button type="button" onClick={openTutorForQuizReview}>
                  Open Tutor For Review
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {questions.map((question, index) => {
                const selected = selectedAnswers[index] ?? "No answer selected";
                const isCorrect = Boolean(submittedResults[index]?.correct);
                return (
                  <div key={`result-${index}-${question.prompt}`} className="rounded-xl border bg-background/60 p-3">
                    <p className="text-sm font-semibold">
                      {index + 1}. {isCorrect ? "Correct" : "Incorrect"}
                    </p>
                    <p className="mt-1 text-sm">{question.prompt}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Your answer: {selected}</p>
                    {!isCorrect ? <p className="text-xs text-muted-foreground">Correct answer: {question.answer}</p> : null}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
