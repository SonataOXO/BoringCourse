import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateStructured } from "@/lib/server/openai";

const requestSchema = z.object({
  studentName: z.string().optional(),
  userToday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  goals: z.array(z.string()).default([]),
  userPrompt: z.string().optional(),
  conversationContext: z.string().optional(),
  selectedUnits: z.array(z.string()).default([]),
  selectedCourse: z
    .object({
      id: z.number().optional(),
      name: z.string(),
      currentScore: z.number().nullable().optional(),
    })
    .optional(),
  selectedAssignments: z
    .array(
      z.object({
        name: z.string(),
        submissionScore: z.number().nullable().optional(),
        pointsPossible: z.number().nullable().optional(),
        conceptHint: z.string().optional(),
      }),
    )
    .default([]),
  courses: z.array(z.object({ id: z.number(), name: z.string(), currentScore: z.number().nullable().optional() })).default([]),
  focusRecommendations: z
    .array(
      z.object({
        subject: z.string(),
        priority: z.enum(["high", "medium", "low"]),
        concept: z.string(),
        why: z.string(),
        suggestedMinutesPerWeek: z.number(),
      }),
    )
    .default([]),
  uploadedMaterials: z
    .array(
      z.object({
        title: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
  images: z.array(z.string().startsWith("data:image/")).max(5).default([]),
  canvasContext: z.record(z.string(), z.unknown()).optional(),
  lockedScope: z.record(z.string(), z.unknown()).optional(),
  userPrefs: z.record(z.string(), z.unknown()).optional(),
});

type Badge = "Confirmed on test" | "Likely on test" | "May not be on test";

type Topic = {
  topic: string;
  badge: Badge;
  why_included: string;
  evidence: Array<{ from: "quiz" | "module" | "assignment" | "file" | "announcement" | "inference"; note: string }>;
};

type GeneratorOutput = {
  status: "READY";
  meta: {
    course: { id: string | null; name: string | null; teacher_names: string[] };
    assessment: {
      type: "quiz" | "assignment" | "unknown";
      id: string | null;
      title: string | null;
      due_at: string | null;
      time_limit_minutes: number | null;
      allowed_attempts: number | null;
      format: { mcq: "true" | "false" | "unknown"; free_response: "true" | "false" | "unknown"; graphing: "true" | "false" | "unknown" };
    };
    scope_confidence: number;
    assumptions: string[];
    sources_used: {
      modules: string[];
      assignments: string[];
      quizzes: string[];
      pages: string[];
      files: string[];
      announcements: string[];
      grade_signals_used: boolean;
    };
  };
  scope_lock: {
    topics: Topic[];
    out_of_scope_topics: string[];
  };
  study_guide: {
    overview: {
      test_ready_definition: string;
      estimated_total_minutes: number;
      if_you_have_20_min: string[];
      if_you_have_45_min: string[];
      if_you_have_75_min: string[];
    };
    sections: Array<Record<string, unknown>>;
  };
  checklist: {
    items: Array<{
      id: string;
      task: string;
      badge: Badge;
      done_when: string;
      linked_section_id: string;
    }>;
  };
  tutor_handoff: {
    button_label: string;
    brief: string;
    context: {
      course: { id: string | null; name: string | null };
      assessment: { type: "quiz" | "assignment" | "unknown"; id: string | null; title: string | null; due_at: string | null };
      topics: Array<{ topic: string; badge: Badge }>;
      quiz_style: {
        mcq: "true" | "false" | "unknown";
        free_response: "true" | "false" | "unknown";
        graphing: "true" | "false" | "unknown";
        time_limit_minutes: number | null;
      };
      practice_blueprints: Array<{
        topic: string;
        badge: Badge;
        difficulty_mix: string;
        common_traps: string[];
        preferred_question_types: string[];
      }>;
      materials: {
        module_items: Array<{ title: string; type: string; url: string }>;
        files: Array<{ title: string; id: string; url: string }>;
        pages: Array<{ title: string; url: string }>;
        announcements: Array<{ title: string; posted_at: string }>;
      };
    };
    suggested_quick_actions: Array<{ id: string; label: string; prefill_user_message_template: string }>;
  };
  ui_hints: {
    topic_chips: string[];
    default_selected_topics: string[];
    recommended_time_buttons: number[];
  };
};

type LegacyGuide = {
  overview: string;
  clarificationQuestion?: string;
  topicOutline?: { topic: string; concepts: string[] };
  plan: Array<{ day: string; tasks: string[]; minutes: number }>;
  priorities: Array<{ subject: string; reason: string; action: string }>;
  checklist: string[];
};

function safeArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function extractTopicTokens(question: string): string[] {
  const stopWords = new Set([
    "i",
    "need",
    "help",
    "with",
    "the",
    "a",
    "an",
    "for",
    "to",
    "on",
    "and",
    "of",
    "my",
    "quiz",
    "test",
    "study",
    "guide",
    "make",
    "create",
    "build",
    "please",
    "me",
    "what",
    "should",
    "could",
    "would",
    "can",
    "how",
    "when",
    "where",
    "why",
    "which",
    "tell",
  ]);
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2 && !stopWords.has(token)),
    ),
  ).slice(0, 10);
}

function isJunkTopic(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const junkWords = new Set([
    "what",
    "should",
    "could",
    "would",
    "can",
    "how",
    "when",
    "where",
    "why",
    "which",
    "make",
    "create",
    "build",
    "study",
    "guide",
    "quiz",
    "test",
  ]);
  return junkWords.has(normalized);
}

function extractPromptConcepts(prompt: string): string[] {
  const text = prompt.toLowerCase();
  const concepts: string[] = [];
  if (/\b(quadratic|quadratics|qudartic|qudratic)\b/.test(text)) {
    concepts.push("Quadratic functions");
  }
  if (/\bvertex\b/.test(text)) {
    concepts.push("Vertex and axis of symmetry");
  }
  if (/\bfactor(ing)?\b/.test(text)) {
    concepts.push("Factoring quadratics");
  }
  if (/\bcomplete(ing)? the square\b/.test(text)) {
    concepts.push("Completing the square");
  }
  if (/\bquadratic formula\b/.test(text)) {
    concepts.push("Quadratic formula");
  }
  if (/\bdiscriminant\b/.test(text)) {
    concepts.push("Discriminant and number of roots");
  }
  if (/\bcomplex\b/.test(text)) {
    concepts.push("Complex roots");
  }
  return Array.from(new Set(concepts));
}

function inferLikelyTopics(courseName: string, prompt: string): string[] {
  const text = `${courseName} ${prompt}`.toLowerCase();
  const wantsQuadratics = /\b(quadratic|quadratics|qudartic|qudratic)\b/.test(text);
  if (text.includes("algebra 1") || text.includes("algebra i")) {
    return ["Linear equations", "Systems of equations", "Exponents and polynomials"];
  }
  if (text.includes("algebra 2") || text.includes("algebra ii")) {
    if (wantsQuadratics) {
      return [
        "Quadratic functions",
        "Graphing parabolas",
        "Factoring quadratics",
        "Completing the square",
        "Quadratic formula and discriminant",
      ];
    }
    return ["Quadratic functions", "Polynomial operations", "Rational expressions"];
  }
  if (text.includes("chem") || text.includes("chemistry")) {
    return ["Stoichiometry", "Chemical reactions", "Gas laws"];
  }
  if (text.includes("biology") || text.includes("bio")) {
    return ["Cell processes", "Genetics", "Ecology interactions"];
  }
  if (text.includes("history") || text.includes("government") || text.includes("civics")) {
    return ["Key terms and events", "Cause and effect analysis", "Source evidence usage"];
  }
  return ["Core vocabulary", "Primary problem types", "Common assessment patterns"];
}

function pickBadge(hasDirectEvidence: boolean, hasContextEvidence: boolean): Badge {
  if (hasDirectEvidence) {
    return "Confirmed on test";
  }
  if (hasContextEvidence) {
    return "Likely on test";
  }
  return "May not be on test";
}

function defaultGuide(body: z.infer<typeof requestSchema>, topicTokens: string[]): GeneratorOutput {
  const courseName = body.selectedCourse?.name ?? null;
  const assignmentNames = body.selectedAssignments.map((a) => a.name);
  const inferred = inferLikelyTopics(body.selectedCourse?.name ?? "", body.userPrompt ?? "");
  const explicit = body.selectedAssignments.map((a) => a.conceptHint || a.name).filter(Boolean);
  const unitTopics = body.selectedUnits;
  const promptConcepts = extractPromptConcepts(body.userPrompt ?? "");
  const promptTopics = promptConcepts.length > 0
    ? promptConcepts
    : topicTokens.map((token) => token.replace(/\b\w/g, (c) => c.toUpperCase()));

  const baseTopics = Array.from(new Set([...explicit, ...unitTopics, ...promptTopics, ...inferred]))
    .map((topic) => String(topic).trim())
    .filter((topic) => !isJunkTopic(topic))
    .slice(0, 8);
  const topics: Topic[] = baseTopics.map((topic) => {
    const topicLower = topic.toLowerCase();
    const direct = assignmentNames.some((name) => name.toLowerCase().includes(topicLower)) || explicit.some((name) => String(name).toLowerCase() === topicLower);
    const context = body.selectedUnits.some((name) => name.toLowerCase().includes(topicLower)) || topicTokens.some((t) => topicLower.includes(t));
    const badge = pickBadge(direct, context);
    return {
      topic,
      badge,
      why_included:
        badge === "Confirmed on test"
          ? "Directly supported by selected assignments or explicit course evidence."
          : badge === "Likely on test"
            ? "Strongly inferred from units/context near the assessment window."
            : "Included for complete prep based on common curriculum patterns.",
      evidence: [
        {
          from: badge === "Confirmed on test" ? "assignment" : badge === "Likely on test" ? "module" : "inference",
          note:
            badge === "Confirmed on test"
              ? "Matched assignment/concept naming from selected coursework."
              : badge === "Likely on test"
                ? "Aligned with current units or user-requested topic wording."
                : "Commonly assessed in this course level even without explicit Canvas confirmation.",
        },
      ],
    };
  });

  const weakTopics = body.selectedAssignments
    .filter((a) => typeof a.submissionScore === "number" && typeof a.pointsPossible === "number" && (a.submissionScore ?? 0) / ((a.pointsPossible ?? 1) || 1) < 0.8)
    .map((a) => a.conceptHint || a.name)
    .slice(0, 4);

  const mainTopic = topics[0]?.topic ?? "Current course topic";

  return {
    status: "READY",
    meta: {
      course: { id: body.selectedCourse?.id != null ? String(body.selectedCourse.id) : null, name: courseName, teacher_names: [] },
      assessment: {
        type: "unknown",
        id: null,
        title: body.userPrompt?.trim() || "Upcoming assessment",
        due_at: null,
        time_limit_minutes: null,
        allowed_attempts: null,
        format: { mcq: "unknown", free_response: "unknown", graphing: "unknown" },
      },
      scope_confidence: topics.some((t) => t.badge === "Confirmed on test") ? 80 : topics.some((t) => t.badge === "Likely on test") ? 68 : 55,
      assumptions: [
        ...(body.selectedAssignments.length === 0 ? ["No graded assignment evidence provided, so topic breadth was inferred."] : []),
        ...(body.selectedUnits.length === 0 ? ["No unit metadata supplied; used course-level curriculum patterns."] : []),
      ],
      sources_used: {
        modules: body.selectedUnits.slice(0, 12),
        assignments: assignmentNames.slice(0, 12),
        quizzes: [],
        pages: [],
        files: body.uploadedMaterials.map((m) => m.title).slice(0, 12),
        announcements: [],
        grade_signals_used: weakTopics.length > 0,
      },
    },
    scope_lock: {
      topics,
      out_of_scope_topics: [],
    },
    study_guide: {
      overview: {
        test_ready_definition: `You can solve ${mainTopic} problems accurately, explain each step, and avoid repeated mistake patterns under time pressure.`,
        estimated_total_minutes: 75,
        if_you_have_20_min: ["Run diagnostic Q1-Q2", `Review one ${mainTopic} mistake type`, "Do one timed correction"],
        if_you_have_45_min: ["Complete full diagnostic", "Do one practice set with solution check", "Fix one repeated trap"],
        if_you_have_75_min: ["Diagnostic + two practice sets", "Complete memory/speed drill", "Run final 10-minute simulation"],
      },
      sections: [
        {
          id: "must_know_map",
          title: "What to Know (Mapped to Your Quiz)",
          items: topics.slice(0, 5).map((topic) => ({
            topic: topic.topic,
            badge: topic.badge,
            key_ideas: [`Core rule for ${topic.topic}`, `When to apply ${topic.topic}`],
            can_you_do: [`Solve one standard ${topic.topic} item`, `Explain why your method is valid`],
            common_mistake: `Choosing the wrong approach for ${topic.topic}.`,
            fix: "Identify question type first, then apply one method step-by-step.",
          })),
        },
        {
          id: "diagnostic",
          title: "Diagnostic (8 minutes)",
          instructions: "Use mixed items; if format is unknown, prioritize free response with one MCQ check.",
          questions: topics.slice(0, 4).map((topic, index) => ({
            q: `${topic.topic}: solve one representative quiz-style problem and justify each step.`,
            topic: topic.topic,
            badge: topic.badge,
            type: index % 2 === 0 ? "free_response" : "mcq",
            choices: index % 2 === 0 ? ["A N/A", "B N/A", "C N/A", "D N/A"] : ["A Option 1", "B Option 2", "C Option 3", "D Option 4"],
            answer: index % 2 === 0 ? "See worked steps" : "A",
            solution_steps: ["Identify what is being asked", "Set up the method", "Solve and verify result"],
            if_wrong_then: "Go to practice_sets and redo the matching topic set.",
          })),
          routing_rule: "If you miss 2+ questions in a topic, start with that topic's practice set before mixed review.",
        },
        {
          id: "practice_sets",
          title: "Practice Sets (with Answers)",
          sets: topics.slice(0, 4).map((topic, index) => ({
            set_id: `ps${index + 1}`,
            topic: topic.topic,
            badge: topic.badge,
            skills_tested: [`Method selection for ${topic.topic}`, "Accurate execution", "Error checking"],
            difficulty_mix: "2 easy, 2 medium, 1 hard",
            problems: [
              {
                prompt: `Easy: apply the basic method for ${topic.topic}.`,
                type: "free_response",
                choices: ["A N/A", "B N/A", "C N/A", "D N/A"],
                answer: "Method applied correctly with valid final result.",
                solution_steps: ["Write known information", "Choose method", "Compute and check"],
                common_trap: "Skipping setup and jumping to arithmetic.",
              },
              {
                prompt: `Medium: solve a multi-step ${topic.topic} problem with one distractor detail.`,
                type: "mcq",
                choices: ["A", "B", "C", "D"],
                answer: "B",
                solution_steps: ["Remove irrelevant detail", "Run full solve path", "Check against choices"],
                common_trap: "Using all numbers even when some are irrelevant.",
              },
            ],
            mastery_check: {
              pass_rule: "At least 4/5 correct and no repeated trap type.",
              if_fail_do_this: "Redo the set with written steps, then complete one additional mixed problem.",
            },
          })),
        },
        {
          id: "memory_and_speed",
          title: "Memory + Speed Tricks (Only What You Need)",
          items: topics.slice(0, 3).map((topic) => ({
            topic: topic.topic,
            badge: topic.badge,
            memory_hook: `Use a trigger phrase for ${topic.topic}: 'Identify, Set up, Solve, Check'.`,
            speed_tip: "Spend first 15 seconds identifying method before calculating.",
            "1_min_drill": {
              prompt: `State the method and first step for a ${topic.topic} question in under 60 seconds.`,
              answer: "Method named correctly and first setup step written accurately.",
            },
          })),
        },
        {
          id: "final_review",
          title: "10-Minute Final Review (Simulated)",
          timed_set: topics.slice(0, 3).map((topic) => ({
            prompt: `Timed: solve one mixed ${topic.topic} item quickly and show checks.`,
            answer: "Correct final result with method justification.",
            solution_steps: ["Method label", "Key steps", "Final check"],
            topic: topic.topic,
            badge: topic.badge,
          })),
          scoring: "Score 1 per correct item. If below 80%, redo weakest topic set and repeat one timed item.",
        },
      ],
    },
    checklist: {
      items: topics.slice(0, 5).map((topic, index) => ({
        id: `c${index + 1}`,
        task: `Complete one full ${topic.topic} set and explain one mistake you corrected.`,
        badge: topic.badge,
        done_when: "You score at least 4/5 on that set and can verbalize the corrected error pattern.",
        linked_section_id: `ps${Math.min(index + 1, 4)}`,
      })),
    },
    tutor_handoff: {
      button_label: "Open Tutor with this guide",
      brief: [
        `- Assessment: ${body.userPrompt?.trim() || "Upcoming assessment"}`,
        `- Confirmed topics: ${topics.filter((t) => t.badge === "Confirmed on test").map((t) => t.topic).join(", ") || "None"}`,
        `- Likely topics: ${topics.filter((t) => t.badge === "Likely on test").map((t) => t.topic).join(", ") || "None"}`,
        `- May not be on test: ${topics.filter((t) => t.badge === "May not be on test").map((t) => t.topic).join(", ") || "None"}`,
        `- Weak areas: ${weakTopics.join(", ") || "No strong weakness signal"}`,
      ].join("\n"),
      context: {
        course: { id: body.selectedCourse?.id != null ? String(body.selectedCourse.id) : null, name: body.selectedCourse?.name ?? null },
        assessment: { type: "unknown", id: null, title: body.userPrompt?.trim() || null, due_at: null },
        topics: topics.map((topic) => ({ topic: topic.topic, badge: topic.badge })),
        quiz_style: { mcq: "unknown", free_response: "unknown", graphing: "unknown", time_limit_minutes: null },
        practice_blueprints: topics.slice(0, 4).map((topic) => ({
          topic: topic.topic,
          badge: topic.badge,
          difficulty_mix: "2 easy, 2 medium, 1 hard",
          common_traps: ["Wrong method selection", "Skipping step checks"],
          preferred_question_types: ["free_response", "mcq"],
        })),
        materials: {
          module_items: body.selectedUnits.map((title) => ({ title, type: "module", url: "" })),
          files: body.uploadedMaterials.slice(0, 8).map((item, index) => ({ title: item.title, id: String(index + 1), url: "" })),
          pages: [],
          announcements: [],
        },
      },
      suggested_quick_actions: [
        {
          id: "practice",
          label: "Practice",
          prefill_user_message_template: "Give me quiz-style practice on {selected_topics} with answers and brief feedback.",
        },
        {
          id: "explain",
          label: "Explain",
          prefill_user_message_template: "Explain {selected_topics} step-by-step with one worked example and one check-for-understanding.",
        },
        {
          id: "memorize",
          label: "Memorize",
          prefill_user_message_template: "Give me memory tips for {selected_topics} plus a short recall drill.",
        },
      ],
    },
    ui_hints: {
      topic_chips: topics.map((topic) => topic.topic),
      default_selected_topics: topics.slice(0, 3).map((topic) => topic.topic),
      recommended_time_buttons: [20, 45, 75],
    },
  };
}

function normalizeBadge(value: unknown): Badge {
  if (value === "Confirmed on test" || value === "Likely on test" || value === "May not be on test") {
    return value;
  }
  return "Likely on test";
}

function normalizeGuide(candidate: unknown, fallback: GeneratorOutput): GeneratorOutput {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const obj = candidate as Record<string, unknown>;
  const metaObj = (obj.meta as Record<string, unknown> | undefined) ?? {};
  const assessmentObj = (metaObj.assessment as Record<string, unknown> | undefined) ?? {};
  const sourcesObj = (metaObj.sources_used as Record<string, unknown> | undefined) ?? {};
  const scopeObj = (obj.scope_lock as Record<string, unknown> | undefined) ?? {};
  const studyObj = (obj.study_guide as Record<string, unknown> | undefined) ?? {};
  const overviewObj = (studyObj.overview as Record<string, unknown> | undefined) ?? {};
  const checklistObj = (obj.checklist as Record<string, unknown> | undefined) ?? {};
  const handoffObj = (obj.tutor_handoff as Record<string, unknown> | undefined) ?? {};
  const handoffCtxObj = (handoffObj.context as Record<string, unknown> | undefined) ?? {};
  const uiObj = (obj.ui_hints as Record<string, unknown> | undefined) ?? {};

  const merged: GeneratorOutput = {
    ...fallback,
    status: "READY",
    meta: {
      ...fallback.meta,
      ...metaObj,
      course: {
        ...fallback.meta.course,
        ...((metaObj.course as Record<string, unknown> | undefined) ?? {}),
      },
      assessment: {
        ...fallback.meta.assessment,
        ...assessmentObj,
        format: {
          ...fallback.meta.assessment.format,
          ...((assessmentObj.format as Record<string, unknown> | undefined) ?? {}),
        },
      },
      scope_confidence: Number(metaObj.scope_confidence ?? fallback.meta.scope_confidence),
      assumptions: safeArray<string>(metaObj.assumptions, fallback.meta.assumptions),
      sources_used: {
        ...fallback.meta.sources_used,
        ...sourcesObj,
        modules: safeArray<string>(sourcesObj.modules, fallback.meta.sources_used.modules),
        assignments: safeArray<string>(sourcesObj.assignments, fallback.meta.sources_used.assignments),
        quizzes: safeArray<string>(sourcesObj.quizzes, fallback.meta.sources_used.quizzes),
        pages: safeArray<string>(sourcesObj.pages, fallback.meta.sources_used.pages),
        files: safeArray<string>(sourcesObj.files, fallback.meta.sources_used.files),
        announcements: safeArray<string>(sourcesObj.announcements, fallback.meta.sources_used.announcements),
      },
    },
    scope_lock: {
      ...fallback.scope_lock,
      ...scopeObj,
      topics: safeArray<Topic>(scopeObj.topics, fallback.scope_lock.topics).map((topic) => ({
        ...topic,
        badge: normalizeBadge(topic.badge),
        evidence: safeArray<{ from: "quiz" | "module" | "assignment" | "file" | "announcement" | "inference"; note: string }>(topic.evidence, []),
      })),
      out_of_scope_topics: safeArray<string>(scopeObj.out_of_scope_topics, fallback.scope_lock.out_of_scope_topics),
    },
    study_guide: {
      ...fallback.study_guide,
      ...studyObj,
      overview: {
        ...fallback.study_guide.overview,
        ...overviewObj,
        if_you_have_20_min: safeArray<string>(overviewObj.if_you_have_20_min, fallback.study_guide.overview.if_you_have_20_min),
        if_you_have_45_min: safeArray<string>(overviewObj.if_you_have_45_min, fallback.study_guide.overview.if_you_have_45_min),
        if_you_have_75_min: safeArray<string>(overviewObj.if_you_have_75_min, fallback.study_guide.overview.if_you_have_75_min),
      },
      sections: safeArray<Record<string, unknown>>(studyObj.sections, fallback.study_guide.sections),
    },
    checklist: {
      ...fallback.checklist,
      ...checklistObj,
      items: safeArray<{ id: string; task: string; badge: Badge; done_when: string; linked_section_id: string }>(
        checklistObj.items,
        fallback.checklist.items,
      ).map((item) => ({
        ...item,
        badge: normalizeBadge(item.badge),
      })),
    },
    tutor_handoff: {
      ...fallback.tutor_handoff,
      ...handoffObj,
      context: {
        ...fallback.tutor_handoff.context,
        ...handoffCtxObj,
      },
      suggested_quick_actions: safeArray<{ id: string; label: string; prefill_user_message_template: string }>(
        handoffObj.suggested_quick_actions,
        fallback.tutor_handoff.suggested_quick_actions,
      ),
    },
    ui_hints: {
      ...fallback.ui_hints,
      ...uiObj,
      topic_chips: safeArray<string>(uiObj.topic_chips, fallback.ui_hints.topic_chips),
      default_selected_topics: safeArray<string>(uiObj.default_selected_topics, fallback.ui_hints.default_selected_topics),
      recommended_time_buttons: safeArray<number>(uiObj.recommended_time_buttons, fallback.ui_hints.recommended_time_buttons),
    },
  };

  if (merged.scope_lock.topics.length === 0) {
    merged.scope_lock.topics = fallback.scope_lock.topics;
  }
  merged.scope_lock.topics = merged.scope_lock.topics.filter((topic) => !isJunkTopic(topic.topic));
  if (merged.scope_lock.topics.length === 0) {
    merged.scope_lock.topics = fallback.scope_lock.topics.filter((topic) => !isJunkTopic(topic.topic));
  }

  const chips = merged.scope_lock.topics.map((topic) => topic.topic).filter(Boolean);
  if (chips.length > 0) {
    merged.ui_hints.topic_chips = chips;
    if (merged.ui_hints.default_selected_topics.length === 0) {
      merged.ui_hints.default_selected_topics = chips.slice(0, 3);
    }
  }

  return merged;
}

function toLegacyGuide(generated: GeneratorOutput, userPrompt?: string): LegacyGuide {
  const topics = generated.scope_lock.topics;
  const checklistTasks = generated.checklist.items.map((item) => item.task);
  const diagnosticSection = generated.study_guide.sections.find((section) => section.id === "diagnostic") as
    | { questions?: Array<{ topic?: string }> }
    | undefined;
  const practiceSection = generated.study_guide.sections.find((section) => section.id === "practice_sets") as
    | { sets?: Array<{ topic?: string; set_id?: string }> }
    | undefined;
  const finalReviewSection = generated.study_guide.sections.find((section) => section.id === "final_review") as
    | { timed_set?: Array<{ topic?: string }> }
    | undefined;

  const diagnosticTopics = (diagnosticSection?.questions ?? [])
    .map((item) => item.topic)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const practiceTopics = (practiceSection?.sets ?? [])
    .map((item) => item.topic)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const finalTopics = (finalReviewSection?.timed_set ?? [])
    .map((item) => item.topic)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const genericTopicWords = new Set(["algebra", "math", "mathematics", "general", "topic", "concept"]);
  const specificTopics = Array.from(
    new Set([...practiceTopics, ...diagnosticTopics, ...finalTopics, ...topics.map((item) => item.topic)]),
  ).filter((topic) => {
    const lowered = topic.trim().toLowerCase();
    if (!lowered) {
      return false;
    }
    if (genericTopicWords.has(lowered)) {
      return false;
    }
    return lowered.split(/\s+/).some((part) => !genericTopicWords.has(part));
  });
  const primaryTopic = specificTopics[0] ?? topics[0]?.topic ?? userPrompt?.trim() ?? "current quiz topic";
  const secondaryTopic = specificTopics[1] ?? specificTopics[0] ?? primaryTopic;
  const tertiaryTopic = specificTopics[2] ?? secondaryTopic;

  const priorities = topics.slice(0, 3).map((topic) => ({
    subject: `${topic.topic} (${topic.badge})`,
    reason: topic.why_included,
    action: `Do the matching practice set and hit its mastery check for ${topic.topic}.`,
  }));

  const mondayTasks = [
    `Run a 10-minute diagnostic on ${primaryTopic} and mark each missed step.`,
    `Complete 6 targeted ${primaryTopic} problems; write 1-line justification per solution.`,
    `Correct your top 2 recurring errors in ${secondaryTopic} and re-solve those items.`,
  ];
  const wednesdayTasks = [
    `Do a timed mixed set: 4 ${secondaryTopic} + 4 ${tertiaryTopic} questions (20 minutes).`,
    `Run a final-review simulation on ${primaryTopic} and ${secondaryTopic}; target >= 80% accuracy.`,
    `Create a mini cheat-sheet of 5 rules/formulas for ${primaryTopic} and self-quiz without notes.`,
  ];

  return {
    overview: generated.study_guide.overview.test_ready_definition,
    clarificationQuestion: "",
    topicOutline: {
      topic: topics[0]?.topic || userPrompt?.trim() || "Selected topic",
      concepts: topics.map((topic) => topic.topic).slice(0, 8),
    },
    plan: [
      {
        day: "Monday",
        tasks: mondayTasks,
        minutes: 45,
      },
      {
        day: "Wednesday",
        tasks: wednesdayTasks,
        minutes: 45,
      },
    ],
    priorities,
    checklist: checklistTasks.length > 0 ? checklistTasks : ["Complete one measurable practice set and pass its mastery check"],
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());
    const topicTokens = extractTopicTokens(body.userPrompt?.trim() ?? "");
    const fallback = defaultGuide(body, topicTokens);

    const systemPrompt = [
      "You are StudyGuideGenerator inside a Canvas-connected study app.",
      "MISSION: Generate a detailed, test-ready study guide and checklist that is self-sufficient even without TutorAI.",
      "Use CANVAS_CONTEXT and LOCKED_SCOPE as primary scope sources when available.",
      "If Canvas data is weak/missing, still generate a useful detailed guide using reasonable curriculum inference from course name + user wording.",
      "BADGES are required per topic: Confirmed on test, Likely on test, May not be on test.",
      "Any non-Canvas-supported topic MUST be marked May not be on test with a short reason.",
      "Include practice with answers and solution_steps. No vague filler.",
      "Checklist items must be measurable with done_when conditions.",
      "Return ONE JSON object only, no markdown, no extra prose.",
      "Required top-level keys: status, meta, scope_lock, study_guide, checklist, tutor_handoff, ui_hints.",
      "Set status to READY.",
    ].join(" ");

    const compactMaterials = body.uploadedMaterials.slice(0, 8).map((item) => ({
      title: item.title.slice(0, 120),
      content: item.content.slice(0, 1500),
    }));

    const canvasContext = body.canvasContext ?? {
      course: body.selectedCourse ?? null,
      assignments: body.selectedAssignments,
      modules: body.selectedUnits,
      gradebook_signals: body.selectedAssignments
        .filter((item) => typeof item.submissionScore === "number" && typeof item.pointsPossible === "number")
        .map((item) => ({ item_name: item.name, score: item.submissionScore, points: item.pointsPossible })),
      uploaded_materials: compactMaterials,
      focus_recommendations: body.focusRecommendations,
    };

    const modelInput = {
      USER_QUESTION: body.userPrompt ?? "",
      USER_TODAY: body.userToday ?? null,
      CANVAS_CONTEXT: canvasContext,
      LOCKED_SCOPE: body.lockedScope ?? null,
      USER_PREFS: body.userPrefs ?? {
        goals: body.goals,
        conversation_context: body.conversationContext ?? "",
      },
    };

    const generatedRaw = await generateStructured<Record<string, unknown>>(systemPrompt, JSON.stringify(modelInput), fallback, {
      imageDataUrls: body.images,
      maxOutputTokens: 3600,
      reasoningEffort: "low",
    });

    const generated = normalizeGuide(generatedRaw, fallback);
    const legacyGuide = toLegacyGuide(generated, body.userPrompt);

    return NextResponse.json({
      studyGuide: legacyGuide,
      studyGuideStructured: generated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate study guide",
      },
      { status: 400 },
    );
  }
}
