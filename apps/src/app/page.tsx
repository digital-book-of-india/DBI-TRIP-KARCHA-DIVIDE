export default function Home() {
  const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL || "http://localhost:5173";
  return (
    <main className="p-8 max-w-2xl mx-auto font-sans text-slate-100 bg-slate-950 min-h-screen">
      <section className="p-7 bg-slate-900 border border-slate-800 rounded-xl">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Trip Kharcha Divide</p>
        <h1 className="mt-2 text-2xl font-bold text-white">Sign in through Common Workspace</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Trip Kharcha uses the main application account. Open Common Workspace, sign in there, and launch Trip Kharcha from your dashboard.
        </p>
        <a className="inline-flex mt-5 px-4 py-2 bg-emerald-500 text-slate-950 font-bold rounded text-sm" href={mainAppUrl}>
          Open Common Workspace
        </a>
      </section>
    </main>
  );
}