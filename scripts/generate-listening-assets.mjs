import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const essayPath = join(root, "src/essays/the-weather-between-us.md");
const outDir = join(root, "public/audio");

const markdown = await readFile(essayPath, "utf8");

function frontmatterValue(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.replace(/^["']|["']$/g, "").trim() ?? "";
}

function stripFrontmatter(source) {
  return source.replace(/^---[\s\S]*?---\s*/, "");
}

function stripAfterNotes(source) {
  return source.split(/\n---\n/)[0];
}

function cleanMarkdown(source) {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("!["))
    .filter((line) => !line.trim().startsWith("[^"))
    .map((line) =>
      line
        .replace(/^#{1,4}\s+/g, "")
        .replace(/^>\s?/g, "")
        .replace(/\[\^.+?\]/g, "")
        .replace(/!\[(.*?)\]\(.+?\)/g, "$1")
        .replace(/\[(.*?)\]\(.+?\)/g, "$1")
        .replace(/[*_`]/g, "")
        .replace(/&amp;/g, "&")
        .trim()
    )
    .filter(Boolean)
    .join("\n\n");
}

function splitPhrases(text) {
  const paragraphs = text.split(/\n{2,}/);
  const phrases = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const words = sentence.split(/\s+/);
      if (words.length <= 18) {
        phrases.push(sentence);
        continue;
      }

      let current = [];
      for (const word of words) {
        current.push(word);
        const joined = current.join(" ");
        if (current.length >= 12 && /[,;:]$/.test(word)) {
          phrases.push(joined);
          current = [];
        } else if (current.length >= 18) {
          phrases.push(joined);
          current = [];
        }
      }
      if (current.length) phrases.push(current.join(" "));
    }
  }

  return phrases;
}

function themeFor(text) {
  const lower = text.toLowerCase();
  if (/(barragán|house|room|corridor|stone|wall|water|light|architecture|surface)/.test(lower)) return "house";
  if (/(alicia|sunday|partnership|system|ai|machine|software)/.test(lower)) return "alicia";
  if (/(author|authorship|pen|hand|life|present|human scale)/.test(lower)) return "authorship";
  if (/(weather|feeling|mood|climate|affect|slow|time|grain|condition)/.test(lower)) return "weather";
  if (/(coda|industry|primitive|orientation|essays)/.test(lower)) return "coda";
  return "field";
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

const title = frontmatterValue(markdown, "title");
const dek = frontmatterValue(markdown, "dek");
const body = cleanMarkdown(stripAfterNotes(stripFrontmatter(markdown)));
const narration = `${title}\n\n${dek}\n\n${body}\n`;
const phrases = splitPhrases(`${title}. ${dek}\n\n${body}`);

const wordsPerMinute = 148;
let cursor = 0.8;
const segments = phrases.map((text, index) => {
  const duration = Math.max(2.1, (wordCount(text) / wordsPerMinute) * 60 + 0.55);
  const start = cursor;
  const end = start + duration;
  cursor = end + (/[.!?]$/.test(text) ? 0.28 : 0.12);
  return {
    index,
    start: Number(start.toFixed(2)),
    end: Number(end.toFixed(2)),
    theme: themeFor(text),
    text
  };
});

const transcript = {
  title,
  slug: basename(essayPath, ".md"),
  audio: "/audio/the-weather-between-us.m4a",
  generatedFrom: "src/essays/the-weather-between-us.md",
  estimatedDuration: Number((segments.at(-1)?.end ?? 0).toFixed(2)),
  segments
};

try {
  const audioPath = join(outDir, "the-weather-between-us.m4a");
  const info = execFileSync("afinfo", [audioPath], { encoding: "utf8" });
  const actualDuration = Number(info.match(/estimated duration:\s+([0-9.]+)/)?.[1]);
  const estimatedDuration = segments.at(-1)?.end ?? 0;

  if (Number.isFinite(actualDuration) && estimatedDuration > 0) {
    const timingScale = actualDuration / estimatedDuration;
    transcript.actualDuration = actualDuration;
    transcript.timingScale = Number(timingScale.toFixed(6));
    transcript.segments = segments.map((segment) => ({
      ...segment,
      start: Number((segment.start * timingScale).toFixed(2)),
      end: Number((segment.end * timingScale).toFixed(2))
    }));
    transcript.estimatedDuration = Number(transcript.segments.at(-1).end.toFixed(2));
  }
} catch (_error) {
  // The audio file may not exist the first time this generator runs.
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "the-weather-between-us.txt"), narration, "utf8");
await writeFile(join(outDir, "the-weather-between-us.transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`, "utf8");

console.log(`Wrote ${segments.length} transcript segments.`);
