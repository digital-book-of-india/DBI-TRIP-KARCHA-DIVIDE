"use client";
import { useState, useEffect } from "react";

export default function Home() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [trip, setTrip] = useState<any>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [inv, setInv] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ displayName: "Prabhjot", email: "prabhjot@dbi.com", password: "password123" });

  useEffect(() => {
    const t = localStorage.getItem("t");
    if (t) { setToken(t); setUser(JSON.parse(localStorage.getItem("u") || "{}")); }
  }, []);

  const auth = async (type: string) => {
    setMsg("");
    const res = await fetch(`/api/auth/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const d = await res.json();
    if (!d.success) return setMsg("Error: " + d.error);
    setToken(d.data.token);
    setUser(d.data.user);
    localStorage.setItem("t", d.data.token);
    localStorage.setItem("u", JSON.stringify(d.data.user));
    setMsg(`${type} successful!`);
  };

  const getTrips = async () => {
    const res = await fetch("/api/trips", { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    if (d.success) setTrips(d.data.trips);
  };
  useEffect(() => { if (token) getTrips(); }, [token]);

  const addTrip = async () => {
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name })
    });
    const d = await res.json();
    if (d.success) { setName(""); getTrips(); setMsg("Trip created successfully!"); }
  };

  const openTrip = async (id: string) => {
    const res = await fetch(`/api/trips/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    if (d.success) setTrip(d.data);
  };

  const makeInvite = async () => {
    const res = await fetch(`/api/trips/${trip.trip.id}/invites`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await res.json();
    if (d.success) setInv(d.data.inviteCode);
  };

  const join = async () => {
    const res = await fetch("/api/trips/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inviteCode: code })
    });
    const d = await res.json();
    setMsg(d.message || d.error);
    if (d.success) { setCode(""); getTrips(); }
  };

  const close = async () => {
    const res = await fetch(`/api/trips/${trip.trip.id}/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await res.json();
    if (d.success) { setMsg("Trip closed successfully!"); openTrip(trip.trip.id); getTrips(); }
  };

  return (
    <main className="p-8 max-w-4xl mx-auto font-sans text-slate-100 bg-slate-950 min-h-screen">
      <div className="flex justify-between items-center pb-4 border-b border-slate-800 mb-6">
        <div>
          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold uppercase tracking-wider">DEV 1 ENGINE (PostgreSQL Supabase)</span>
          <h1 className="text-2xl font-black mt-1 text-white">DBI Trip Karcha Divide</h1>
        </div>
        {token && (
          <button onClick={() => { localStorage.clear(); setToken(""); setUser(null); setTrip(null); }} className="px-3 py-1 bg-rose-500/20 text-rose-300 rounded border border-rose-500/40 text-xs font-bold hover:bg-rose-500/30">
            Logout ({user?.displayName})
          </button>
        )}
      </div>

      {msg && <div className="p-3 mb-4 bg-slate-900 border border-emerald-500/50 text-emerald-300 rounded text-xs">{msg}</div>}

      {!token ? (
        <div className="max-w-sm mx-auto p-6 bg-slate-900 rounded-xl border border-slate-800 space-y-3 shadow-xl">
          <h2 className="text-base font-bold text-white mb-2">Sign In or Create Account</h2>
          <input className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded text-sm text-white" placeholder="Display Name" value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} />
          <input className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded text-sm text-white" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          <input className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded text-sm text-white" type="password" placeholder="Password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
          <div className="flex gap-2 pt-2">
            <button onClick={() => auth("signup")} className="flex-1 py-2 bg-emerald-500 text-slate-950 font-bold rounded text-sm hover:bg-emerald-400">Sign Up</button>
            <button onClick={() => auth("login")} className="flex-1 py-2 bg-slate-800 text-white font-bold rounded text-sm border border-slate-700 hover:bg-slate-700">Sign In</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
              <h3 className="font-semibold text-sm text-white">Create Trip</h3>
              <input className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-sm text-white" placeholder="Trip Name (e.g. Manali 2026)" value={name} onChange={e => setName(e.target.value)} />
              <button onClick={addTrip} className="w-full py-2 bg-emerald-500 text-slate-950 font-bold rounded text-sm hover:bg-emerald-400">Create Trip</button>
            </div>
            <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
              <h3 className="font-semibold text-sm text-white">Join With Invite Code</h3>
              <input className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-sm font-mono uppercase text-center text-white" placeholder="8-char code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} />
              <button onClick={join} className="w-full py-2 bg-cyan-500 text-slate-950 font-bold rounded text-sm hover:bg-cyan-400">Join Trip</button>
            </div>
            <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
              <h3 className="font-semibold text-sm text-white mb-2">My Trips ({trips.length})</h3>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {trips.map(t => (
                  <button key={t.id} onClick={() => openTrip(t.id)} className="w-full text-left p-2.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-sm flex justify-between items-center">
                    <span className="font-semibold text-white">{t.name}</span>
                    <span className="text-[10px] px-2 py-0.5 bg-slate-800 text-emerald-400 font-mono rounded">{t.status}</span>
                  </button>
                ))}
                {trips.length === 0 && <p className="text-xs text-slate-500 py-2">No trips found.</p>}
              </div>
            </div>
          </div>
          <div>
            {trip ? (
              <div className="p-5 bg-slate-900 rounded-xl border border-slate-800 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">{trip.trip.name}</h2>
                    <p className="text-xs text-slate-400">Role: <b className="text-amber-400">{trip.currentUserRole}</b> • Status: <b className="text-emerald-400">{trip.trip.status}</b></p>
                  </div>
                  <div className="flex gap-2">
                    {trip.currentUserRole === "ADMIN" && trip.trip.status === "ACTIVE" && (
                      <button onClick={close} className="px-3 py-1 bg-rose-500/20 text-rose-300 rounded text-xs font-bold hover:bg-rose-500/30">Close Trip</button>
                    )}
                    <button onClick={makeInvite} disabled={trip.trip.status !== "ACTIVE"} className="px-3 py-1 bg-emerald-500 text-slate-950 rounded text-xs font-bold hover:bg-emerald-400 disabled:opacity-50">Generate Invite</button>
                  </div>
                </div>
                {inv && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 rounded flex justify-between items-center">
                    <span className="text-xs text-emerald-300">Invite Code: <b className="font-mono text-white text-base ml-2">{inv}</b></span>
                    <button onClick={() => navigator.clipboard.writeText(inv)} className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded">Copy</button>
                  </div>
                )}
                <div>
                  <h4 className="text-xs uppercase text-slate-400 font-semibold mb-2">Trip Members ({trip.members.length})</h4>
                  <div className="space-y-1.5">
                    {trip.members.map((m: any) => (
                      <div key={m.memberId} className="p-2.5 bg-slate-950 rounded border border-slate-800 text-xs flex justify-between items-center">
                        <div>
                          <p className="font-semibold text-white">{m.displayName}</p>
                          <p className="text-[11px] text-slate-400">{m.email}</p>
                        </div>
                        <span className="text-amber-400 font-mono font-bold bg-amber-400/10 px-2 py-0.5 rounded">{m.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
                Select a trip from the left panel to see members and invite code.
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}