import fs from 'fs';
import path from 'path';
import sanitizeHtml from 'sanitize-html';
import { createClient } from '@supabase/supabase-js';
import { PLAN_FEATURES, type PlanName } from '@/lib/plans';
import en from '../../../messages/en.json';
import HELP_PAGES from './help-pages.json';

// The public help server at /api/mcp/help: Brelio's help pages, blog and plans, with no sign-in, so any assistant
// can answer a salon owner's questions before (or without) connecting a salon at /api/mcp.

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://brelio.eu';

/** Only the customer-facing parts of the knowledge base; the marketing notes next to them stay internal. */
export const HELP_SECTIONS = ['features', 'howto', 'troubleshooting'] as const;
export const HELP_DIR = path.join(process.cwd(), 'marketing-kb', 'obsidian', 'Brelio');

export interface HelpPage {
  slug: string;
  section: (typeof HELP_SECTIONS)[number];
  title: string;
  text: string;
}

/** Reads the Markdown pages; scripts/build-mcp-help.ts writes them to help-pages.json, which the server serves. */
export function loadHelp(dir = HELP_DIR): HelpPage[] {
  const pages: HelpPage[] = [];
  for (const section of HELP_SECTIONS) {
    const sectionDir = path.join(dir, section);
    if (!fs.existsSync(sectionDir)) continue;
    for (const file of fs.readdirSync(sectionDir).filter((f) => f.endsWith('.md')).sort()) {
      const raw = fs.readFileSync(path.join(sectionDir, file), 'utf-8');
      const text = raw
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // Obsidian [[link|label]] → label
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/^tags:.*$/m, '')
        .trim();
      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file.replace(/\.md$/, '');
      pages.push({ slug: file.replace(/\.md$/, '').toLowerCase(), section, title, text });
    }
  }
  return pages;
}

const help = () => HELP_PAGES as HelpPage[];

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** Pages ranked by how many of the query's words they contain, a word in the title counting three times. */
export function searchHelp(pages: HelpPage[], query: string, limit = 5) {
  const wanted = words(query);
  return pages
    .map((p) => {
      const title = p.title.toLowerCase();
      const body = p.text.toLowerCase();
      const score = wanted.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
      return { p, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => ({ slug: p.slug, section: p.section, title: p.title }));
}

function anon() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
}

const LANGUAGES = ['pl', 'en'] as const;
type Language = (typeof LANGUAGES)[number];
const languageOf = (v: unknown): Language => (v === 'en' ? 'en' : 'pl');

const PRICES: Record<PlanName, { monthly: number; yearly: number }> = {
  solo: { monthly: 49, yearly: 490 },
  salon: { monthly: 99, yearly: 990 },
  pro: { monthly: 149, yearly: 1490 },
};

export function plans() {
  const b = en.billing as Record<string, string>;
  return {
    currency: 'PLN for salons in Poland, EUR everywhere else (same amounts)',
    trial: b.trialBanner,
    plans: (Object.keys(PRICES) as PlanName[]).map((plan) => ({
      plan,
      for: b[`${plan}PlanFor`],
      monthly: PRICES[plan].monthly,
      yearly: PRICES[plan].yearly,
      highlights: [1, 2, 3].map((i) => b[`${plan}Feature${i}`]),
      maxStylists: PLAN_FEATURES[plan].max_stylists,
      includedMessageCredits: PLAN_FEATURES[plan].included_message_credits,
    })),
    url: `${SITE}/en/pricing`,
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const language = { type: 'string', enum: LANGUAGES, description: 'Article language: pl or en; pl when left out' };

export const HELP_TOOLS = [
  {
    name: 'brelio_search_help',
    title: 'Search help',
    description:
      "Searches Brelio's help pages (features, how-to guides and troubleshooting for salon owners) by words, e.g. " +
      '"online booking", "stripe" or "reminders". The pages are written in Russian; each result has its slug and title.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', description: 'Words to look for, in Russian or English product terms' } },
    },
    annotations: { title: 'Search help', ...readOnly },
  },
  {
    name: 'brelio_get_help',
    title: 'Get help page',
    description: 'A help page in full as Markdown (written in Russian): what a feature does or the steps in the web and mobile app.',
    inputSchema: {
      type: 'object',
      required: ['slug'],
      properties: { slug: { type: 'string', description: "The page's slug, as the help search gives it" } },
    },
    annotations: { title: 'Get help page', ...readOnly },
  },
  {
    name: 'brelio_list_articles',
    title: 'List blog articles',
    description: "Brelio's blog for salon owners (running a salon, reminders and no-shows, client loyalty, software comparisons): titles, short summaries and pages.",
    inputSchema: { type: 'object', properties: { language } },
    annotations: { title: 'List blog articles', ...readOnly },
  },
  {
    name: 'brelio_get_article',
    title: 'Get blog article',
    description: 'A blog article in full as plain text, with its page.',
    inputSchema: {
      type: 'object',
      required: ['slug'],
      properties: { slug: { type: 'string', description: "The article's slug, as the article list gives it" }, language },
    },
    annotations: { title: 'Get blog article', ...readOnly },
  },
  {
    name: 'brelio_get_plans',
    title: 'Get plans and prices',
    description: "Brelio's plans (Solo, Salon, Pro): monthly and yearly price, who each is for, the stylist limit, included message credits and the free trial.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Get plans and prices', ...readOnly },
  },
] as const;

export const HELP_INSTRUCTIONS = `Brelio is booking and management software for beauty and hair salons (calendar, online booking, reminders,
clients, staff, payments). This server answers questions about it without an account: the help pages, the blog and
the plans. The help pages are written in Russian: answer in the user's language. Link the page when you use one.
To read and manage their own salon (appointments, clients, services, stats), the salon owner connects ${SITE}/api/mcp
and signs in with their Brelio account.`;

export async function callHelpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'brelio_search_help') {
    const found = searchHelp(help(), String(args.query ?? ''));
    return found.length ? found : { found: [], hint: 'Nothing matched; try other words, e.g. a feature name.' };
  }
  if (name === 'brelio_get_help') {
    const page = help().find((p) => p.slug === String(args.slug ?? '').toLowerCase());
    if (!page) return { error: `No help page "${args.slug}"`, slugs: help().map((p) => p.slug) };
    return page.text;
  }
  if (name === 'brelio_list_articles') {
    const lang = languageOf(args.language);
    const { data, error } = await anon()
      .from('articles')
      .select('slug, title, excerpt, category, published_at')
      .eq('status', 'published')
      .eq('locale', lang)
      .order('published_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((a) => ({ ...a, url: `${SITE}/${lang}/blog/${a.slug}` }));
  }
  if (name === 'brelio_get_article') {
    const lang = languageOf(args.language);
    const { data, error } = await anon()
      .from('articles')
      .select('slug, title, content, published_at')
      .eq('status', 'published')
      .eq('locale', lang)
      .eq('slug', String(args.slug ?? ''))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { error: `No ${lang} article "${args.slug}"` };
    const text = sanitizeHtml(String(data.content ?? '').replace(/<\/(h\d|p|li)>/g, '</$1>\n'), { allowedTags: [], allowedAttributes: {} })
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { title: data.title, published: data.published_at, url: `${SITE}/${lang}/blog/${data.slug}`, text };
  }
  if (name === 'brelio_get_plans') return plans();
  throw new Error(`Unknown tool: ${name}`);
}
