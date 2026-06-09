type Block = { p: string } | { ul: string[] };
type Section = { h: string; blocks: Block[] };

export function LegalDoc({
  title,
  version,
  sections,
}: {
  title: string;
  version: string;
  sections: Section[];
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-zinc-800 dark:text-zinc-200">
      <a href="/" className="text-sm text-zinc-500 underline hover:text-zinc-300">
        {"← Torna a Shadow"}
      </a>
      <h1 className="mt-4 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-zinc-500">{version}</p>
      <div className="mt-8 space-y-6">
        {sections.map((s, i) => (
          <section key={i} className="space-y-2">
            <h2 className="text-lg font-semibold">{s.h}</h2>
            {s.blocks.map((b, j) =>
              "p" in b ? (
                <p key={j} className="text-sm leading-relaxed">
                  {b.p}
                </p>
              ) : (
                <ul key={j} className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
                  {b.ul.map((it, k) => (
                    <li key={k}>{it}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
