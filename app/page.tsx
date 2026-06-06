"use client";

import { ChangeEvent, KeyboardEvent, useMemo, useRef, useState } from "react";

type StandardQuestion = {
  id: string;
  text: string;
  keywords: string[];
};

type SourceQuestion = {
  id: string;
  text: string;
  occurrences: number;
  standardId: string | null;
  matchType: "manual" | "keyword" | null;
  matchedKeyword?: string;
};

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function splitAndDeduplicate(rows: string[][]) {
  const unique = new Map<string, { text: string; occurrences: number }>();

  rows
    .flatMap((row) => row)
    .flatMap((cell) => cell.split(","))
    .map((question) => question.trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean)
    .forEach((question) => {
      const key = normalize(question);
      const existing = unique.get(key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        unique.set(key, { text: question, occurrences: 1 });
      }
    });

  return Array.from(unique.values());
}

function findKeywordMatch(text: string, standards: StandardQuestion[]) {
  const normalizedText = normalize(text);

  return standards
    .flatMap((standard) =>
      standard.keywords.map((keyword) => ({
        standardId: standard.id,
        keyword,
      })),
    )
    .filter(({ keyword }) => normalizedText.includes(normalize(keyword)))
    .sort((first, second) => second.keyword.length - first.keyword.length)[0];
}

export default function Home() {
  const [standards, setStandards] = useState<StandardQuestion[]>([]);
  const [questions, setQuestions] = useState<SourceQuestion[]>([]);
  const [selectedStandardId, setSelectedStandardId] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [standardSearch, setStandardSearch] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"unmatched" | "matched" | "all">(
    "unmatched",
  );
  const [standardFilename, setStandardFilename] = useState("");
  const [questionFilename, setQuestionFilename] = useState("");
  const [notice, setNotice] = useState("");

  const standardInput = useRef<HTMLInputElement>(null);
  const questionInput = useRef<HTMLInputElement>(null);
  const workspaceInput = useRef<HTMLInputElement>(null);

  const selectedStandard = standards.find(
    (standard) => standard.id === selectedStandardId,
  );
  const matchedCount = questions.filter(
    (question) => question.standardId,
  ).length;
  const unmatchedCount = questions.length - matchedCount;

  const visibleStandards = useMemo(
    () =>
      standards.filter((standard) =>
        `${standard.text} ${standard.keywords.join(" ")}`
          .toLowerCase()
          .includes(standardSearch.toLowerCase()),
      ),
    [standardSearch, standards],
  );

  const visibleQuestions = useMemo(
    () =>
      questions.filter((question) => {
        const matchesTab =
          activeTab === "all" ||
          (activeTab === "matched" && question.standardId) ||
          (activeTab === "unmatched" && !question.standardId);
        return (
          matchesTab &&
          question.text.toLowerCase().includes(questionSearch.toLowerCase())
        );
      }),
    [activeTab, questionSearch, questions],
  );

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2500);
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    return file ? { file, text: await file.text() } : null;
  }

  async function importStandards(event: ChangeEvent<HTMLInputElement>) {
    const result = await readFile(event);
    if (!result) return;

    const rows = parseCsv(result.text);
    const imported = rows
      .filter((row) => row[0]?.trim())
      .map((row, index) => ({
        id: `standard-${Date.now()}-${index}`,
        text: row[0].trim(),
        keywords: (row[1] || "")
          .split(/[|;]/)
          .map((keyword) => keyword.trim())
          .filter(Boolean),
      }));

    setStandards(imported);
    setSelectedStandardId(imported[0]?.id || "");
    setStandardFilename(result.file.name);
    flash(`${imported.length} standards loaded`);
  }

  async function importQuestions(event: ChangeEvent<HTMLInputElement>) {
    const result = await readFile(event);
    if (!result) return;

    const rows = parseCsv(result.text);
    const uniqueQuestions = splitAndDeduplicate(rows);
    const imported = uniqueQuestions.map((question, index) => {
      const match = findKeywordMatch(question.text, standards);
      return {
        id: `question-${Date.now()}-${index}`,
        text: question.text,
        occurrences: question.occurrences,
        standardId: match?.standardId || null,
        matchType: match ? ("keyword" as const) : null,
        matchedKeyword: match?.keyword,
      };
    });

    setQuestions(imported);
    setQuestionFilename(result.file.name);
    setActiveTab("unmatched");
    flash(
      `${imported.length} unique questions loaded from ${rows.length} rows`,
    );
  }

  function assignQuestion(questionId: string, standardId: string) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === questionId
          ? {
              ...question,
              standardId: standardId || null,
              matchType: standardId ? "manual" : null,
              matchedKeyword: undefined,
            }
          : question,
      ),
    );
  }

  function applyAllKeywords(nextStandards = standards) {
    let count = 0;

    setQuestions((current) =>
      current.map((question) => {
        if (question.standardId) return question;
        const match = findKeywordMatch(question.text, nextStandards);
        if (!match) return question;
        count += 1;
        return {
          ...question,
          standardId: match.standardId,
          matchType: "keyword",
          matchedKeyword: match.keyword,
        };
      }),
    );

    window.setTimeout(
      () =>
        flash(
          count
            ? `${count} unmatched questions assigned by keyword`
            : "No new keyword matches found",
        ),
      0,
    );
  }

  function addKeyword() {
    const keyword = keywordDraft.trim();
    if (!keyword || !selectedStandardId) return;

    let nextStandards = standards;
    setStandards((current) => {
      nextStandards = current.map((standard) =>
        standard.id === selectedStandardId &&
        !standard.keywords.some(
          (item) => normalize(item) === normalize(keyword),
        )
          ? { ...standard, keywords: [...standard.keywords, keyword] }
          : standard,
      );
      return nextStandards;
    });
    setKeywordDraft("");

    setQuestions((current) => {
      let count = 0;
      const nextQuestions = current.map((question) => {
        if (
          question.standardId ||
          !normalize(question.text).includes(normalize(keyword))
        ) {
          return question;
        }
        count += 1;
        return {
          ...question,
          standardId: selectedStandardId,
          matchType: "keyword" as const,
          matchedKeyword: keyword,
        };
      });
      window.setTimeout(
        () =>
          flash(
            count
              ? `Keyword added and ${count} questions assigned`
              : "Keyword added",
          ),
        0,
      );
      return nextQuestions;
    });
  }

  function removeKeyword(keyword: string) {
    setStandards((current) =>
      current.map((standard) =>
        standard.id === selectedStandardId
          ? {
              ...standard,
              keywords: standard.keywords.filter((item) => item !== keyword),
            }
          : standard,
      ),
    );
  }

  function exportMatches() {
    downloadCsv("question-matches.csv", [
      ["messed_up_question", "standard_question"],
      ...questions.map((question) => [
        question.text,
        standards.find((standard) => standard.id === question.standardId)
          ?.text || "",
      ]),
    ]);
  }

  function saveWorkspace() {
    downloadCsv("question-mapper-workspace.csv", [
      [
        "record_type",
        "id",
        "question",
        "standard_question",
        "keywords",
        "occurrences",
        "matched_standard_id",
        "match_type",
        "matched_keyword",
      ],
      ...standards.map((standard) => [
        "standard",
        standard.id,
        "",
        standard.text,
        standard.keywords.join("|"),
        "",
        "",
        "",
        "",
      ]),
      ...questions.map((question) => [
        "question",
        question.id,
        question.text,
        "",
        "",
        question.occurrences,
        question.standardId || "",
        question.matchType || "",
        question.matchedKeyword || "",
      ]),
    ]);
    flash("Workspace saved");
  }

  async function resumeWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const result = await readFile(event);
    if (!result) return;

    const rows = parseCsv(result.text);
    const headers = rows[0]?.map(normalize) || [];
    const value = (row: string[], column: string) =>
      row[headers.indexOf(column)] || "";

    const restoredStandards = rows
      .slice(1)
      .filter((row) => value(row, "record_type") === "standard")
      .map((row) => ({
        id: value(row, "id"),
        text: value(row, "standard_question"),
        keywords: value(row, "keywords").split("|").filter(Boolean),
      }));

    const restoredQuestions = rows
      .slice(1)
      .filter((row) => value(row, "record_type") === "question")
      .map((row) => ({
        id: value(row, "id"),
        text: value(row, "question"),
        occurrences: Number(value(row, "occurrences")) || 1,
        standardId: value(row, "matched_standard_id") || null,
        matchType: (value(row, "match_type") ||
          null) as SourceQuestion["matchType"],
        matchedKeyword: value(row, "matched_keyword") || undefined,
      }));

    setStandards(restoredStandards);
    setQuestions(restoredQuestions);
    setSelectedStandardId(restoredStandards[0]?.id || "");
    setStandardFilename("Restored workspace");
    setQuestionFilename("Restored workspace");
    flash("Workspace restored");
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white text-[16px] text-slate-900">
      <input
        ref={standardInput}
        hidden
        type="file"
        accept=".csv,text/csv"
        onChange={importStandards}
      />
      <input
        ref={questionInput}
        hidden
        type="file"
        accept=".csv,text/csv"
        onChange={importQuestions}
      />
      <input
        ref={workspaceInput}
        hidden
        type="file"
        accept=".csv,text/csv"
        onChange={resumeWorkspace}
      />

      <header className="shrink-0 border-b border-slate-300 px-6 py-5">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Question matcher</h1>
            <p className="mt-1 text-base text-slate-600">
              Match unique uploaded responses to your standard list.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md border border-slate-400 bg-white px-4 py-2.5 text-base font-medium hover:bg-slate-50"
              onClick={() => standardInput.current?.click()}
            >
              Upload standards
            </button>
            <button
              className="rounded-md border border-slate-400 bg-white px-4 py-2.5 text-base font-medium hover:bg-slate-50"
              onClick={() => questionInput.current?.click()}
            >
              Upload messed-up questions
            </button>
            <button
              className="rounded-md border border-slate-400 bg-white px-4 py-2.5 text-base font-medium hover:bg-slate-50"
              onClick={() => workspaceInput.current?.click()}
            >
              Resume
            </button>
            <button
              className="rounded-md bg-slate-900 px-4 py-2.5 text-base font-medium text-white hover:bg-slate-700"
              onClick={exportMatches}
              disabled={!questions.length}
            >
              Export matches
            </button>
            <button
              className="rounded-md bg-slate-900 px-4 py-2.5 text-base font-medium text-white hover:bg-slate-700"
              onClick={saveWorkspace}
              disabled={!questions.length && !standards.length}
            >
              Save workspace
            </button>
          </div>
        </div>
      </header>

      <div className="shrink-0 border-b border-slate-300 bg-slate-50 px-6 py-3">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-8 gap-y-2 text-base">
          <span>
            <strong>{standards.length}</strong> standards
            {standardFilename && (
              <span className="text-slate-500"> · {standardFilename}</span>
            )}
          </span>
          <span>
            <strong>{questions.length}</strong> unique questions
            {questionFilename && (
              <span className="text-slate-500"> · {questionFilename}</span>
            )}
          </span>
          <span className="text-emerald-700">
            <strong>{matchedCount}</strong> matched
          </span>
          <span className="text-amber-700">
            <strong>{unmatchedCount}</strong> unmatched
          </span>
          <button
            className="ml-auto rounded-md border border-slate-400 bg-white px-3 py-2 font-medium hover:bg-slate-100"
            onClick={() => applyAllKeywords()}
            disabled={!standards.length || !questions.length}
          >
            Run all keywords
          </button>
        </div>
      </div>

      <div className="mx-auto grid min-h-0 w-full max-w-[1500px] flex-1 grid-cols-1 grid-rows-2 overflow-hidden lg:grid-cols-[minmax(340px,38%)_1fr] lg:grid-rows-1">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-slate-300 lg:border-r lg:border-b-0">
          <div className="shrink-0 border-b border-slate-300 p-5">
            <h2 className="text-xl font-semibold">1. Standard questions</h2>

            <input
              className="mt-4 w-full rounded-md border border-slate-400 px-3 py-2.5 text-base outline-none focus:border-blue-600"
              value={standardSearch}
              onChange={(event) => setStandardSearch(event.target.value)}
              placeholder="Search standards"
            />
          </div>

          <div className="shrink-0 border-b border-slate-300 p-5">
            <h3 className="text-lg font-semibold">Filter keywords</h3>

            <p className="mt-2 text-base font-medium italic">
              "{selectedStandard?.text || "Select a standard question"}"
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {selectedStandard?.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-400 px-3 py-1.5 text-base"
                >
                  {keyword}
                  <button
                    className="text-lg leading-none text-slate-500 hover:text-slate-900"
                    onClick={() => removeKeyword(keyword)}
                    aria-label={`Remove ${keyword}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {selectedStandard && !selectedStandard.keywords.length && (
                <span className="text-base text-slate-500">
                  No keywords defined. Manual matching still works.
                </span>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-slate-400 px-3 py-2.5 text-base outline-none focus:border-blue-600"
                value={keywordDraft}
                onChange={(event) => setKeywordDraft(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") addKeyword();
                }}
                placeholder="Example: awareness"
                disabled={!selectedStandard}
              />
              <button
                className="rounded-md bg-blue-700 px-4 py-2.5 text-base font-medium text-white hover:bg-blue-800 disabled:bg-slate-300"
                onClick={addKeyword}
                disabled={!selectedStandard || !keywordDraft.trim()}
              >
                Add
              </button>
            </div>
          </div>

          {!standards.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-6 text-base text-slate-600">
              Upload <strong>standard.csv</strong> to begin.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {visibleStandards.map((standard) => {
                const assignedCount = questions.filter(
                  (question) => question.standardId === standard.id,
                ).length;
                return (
                  <button
                    key={standard.id}
                    className={`block w-full border-b border-slate-200 px-5 py-4 text-left ${
                      selectedStandardId === standard.id
                        ? "bg-blue-50"
                        : "bg-white hover:bg-slate-50"
                    }`}
                    onClick={() => setSelectedStandardId(standard.id)}
                  >
                    <span className="block text-base font-medium leading-6">
                      {standard.text}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {standard.keywords.length} keywords · {assignedCount}{" "}
                      assigned
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-slate-300 p-5">
            <h2 className="text-xl font-semibold">
              2. Unique messed-up questions
            </h2>
            <p className="mt-1 text-base text-slate-600">
              Every uploaded row is split by commas, trimmed, and deduplicated.
              Use the dropdown on any row for edge cases.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {(
                [
                  ["unmatched", `Unmatched (${unmatchedCount})`],
                  ["matched", `Matched (${matchedCount})`],
                  ["all", `All (${questions.length})`],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  className={`rounded-md px-3 py-2 text-base font-medium ${
                    activeTab === tab
                      ? "bg-slate-900 text-white"
                      : "border border-slate-400 bg-white hover:bg-slate-50"
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {label}
                </button>
              ))}
              <input
                className="min-w-[220px] flex-1 rounded-md border border-slate-400 px-3 py-2.5 text-base outline-none focus:border-blue-600"
                value={questionSearch}
                onChange={(event) => setQuestionSearch(event.target.value)}
                placeholder="Search questions"
              />
            </div>
          </div>

          {!questions.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-8 text-base text-slate-600">
              Upload <strong>messed up questions.csv</strong>. The app will
              split each row by commas and produce one unique review list.
            </div>
          ) : (
            <div className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto">
              {visibleQuestions.map((question) => {
                const standard = standards.find(
                  (item) => item.id === question.standardId,
                );
                return (
                  <article
                    key={question.id}
                    className="grid gap-3 px-5 py-4 xl:grid-cols-[1fr_300px] xl:items-center"
                  >
                    <div className="min-w-0">
                      <p className="text-base leading-6">{question.text}</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                        {question.occurrences > 1 && (
                          <span>Appeared {question.occurrences} times</span>
                        )}
                        {question.matchType === "keyword" && (
                          <span className="text-blue-700">
                            Matched by keyword “{question.matchedKeyword}”
                          </span>
                        )}
                        {question.matchType === "manual" && (
                          <span className="text-emerald-700">
                            Manually matched
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-600">
                        Standard question
                      </label>
                      <select
                        className={`w-full rounded-md border px-3 py-2.5 text-base outline-none ${
                          standard
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-amber-500 bg-amber-50"
                        }`}
                        value={question.standardId || ""}
                        onChange={(event) =>
                          assignQuestion(question.id, event.target.value)
                        }
                      >
                        <option value="">Not matched</option>
                        {standards.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.text}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                );
              })}
              {!visibleQuestions.length && (
                <div className="p-8 text-base text-slate-600">
                  No questions in this view.
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {notice && (
        <div className="fixed right-5 bottom-5 rounded-md bg-slate-900 px-4 py-3 text-base text-white shadow-lg">
          {notice}
        </div>
      )}
    </main>
  );
}
