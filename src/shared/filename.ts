/**
 * Custom filename templates.
 * Tokens: {date} {time} {datetime} {title} {mode} {duration} {res} {n}
 */

export interface FilenameContext {
  date: Date;
  title: string;
  mode: string;
  durationMs: number;
  resolution: string;
  counter: number;
}

export const FILENAME_TOKENS = ['{date}', '{time}', '{datetime}', '{title}', '{mode}', '{duration}', '{res}', '{n}'];

const FALLBACK = 'qamrec-recording';
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function tokenValue(token: string, ctx: FilenameContext): string {
  const d = ctx.date;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  switch (token) {
    case 'date':
      return date;
    case 'time':
      return time;
    case 'datetime':
      return `${date}_${time}`;
    case 'title':
      return ctx.title;
    case 'mode':
      return ctx.mode;
    case 'duration': {
      const s = Math.round(ctx.durationMs / 1000);
      return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
    }
    case 'res':
      return ctx.resolution;
    case 'n':
      return pad(ctx.counter, 3);
    default:
      return '';
  }
}

export function buildFilename(template: string, ctx: FilenameContext, extension: string): string {
  const filled = template.replace(/\{(\w+)\}/g, (_, token: string) => tokenValue(token, ctx));
  const safe = filled
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return `${safe || FALLBACK}.${extension}`;
}
