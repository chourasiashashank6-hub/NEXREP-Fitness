import { useCallback, useState } from "react";
import { GLOBAL_EXERCISES, type GlobalExercise } from "../constants/GlobalExercisesData";

export type SearchResult = GlobalExercise & { matchScore: number };

function normalise(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchExercises(query: string, limit = 8): SearchResult[] {
  if (!query || query.trim().length < 2) return [];
  const q = normalise(query);
  const qWords = q.split(" ");

  const scored = GLOBAL_EXERCISES.map((ex) => {
    const nameNorm = normalise(ex.name);
    const aliasNorms = ex.aliases.map(normalise);

    let score = 0;

    if (nameNorm === q || aliasNorms.includes(q)) {
      score = 1.0;
    } else if (nameNorm.startsWith(q)) {
      score = 0.9;
    } else if (aliasNorms.some((a) => a.startsWith(q))) {
      score = 0.85;
    } else if (nameNorm.includes(q)) {
      score = 0.8;
    } else if (aliasNorms.some((a) => a.includes(q))) {
      score = 0.75;
    } else {
      const nameWords = nameNorm.split(" ");
      const allWords = [...nameWords, ...aliasNorms.flatMap((a) => a.split(" "))];
      const matches = qWords.filter((w) => allWords.some((aw) => aw.startsWith(w)));
      if (matches.length > 0) {
        score = (matches.length / qWords.length) * 0.7;
      }
    }

    return { ...ex, matchScore: score };
  });

  return scored
    .filter((r) => r.matchScore > 0.2)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

export function useGlobalExercises() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  const search = useCallback((text: string) => {
    setQuery(text);
    setResults(searchExercises(text));
  }, []);

  const clear = useCallback(() => {
    setQuery("");
    setResults([]);
  }, []);

  return { query, results, search, clear };
}
