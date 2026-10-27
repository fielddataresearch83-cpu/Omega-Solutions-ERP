import { useState } from "react"
import {
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  Factory,
  Globe2,
  HeartHandshake,
  Menu,
  PackageCheck,
  Play,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react"

const modules = [
  {
    name: "CRM",
    label: "Customer relationships",
    description: "Keep customer details, conversations, opportunities, and follow-ups connected in one clear pipeline.",
    items: ["Customer records", "Sales pipeline", "Follow-up tracking"],
    icon: HeartHandshake,
    accent: "var(--primary)",
    glow: "rgba(15,185,111,.08)",
  },
  {
    name: "Finance",
    label: "Financial control",
    description: "Connect everyday transactions with accounting, reporting, and a clearer view of business performance.",
    items: ["Accounting & ledgers", "Invoices and payments", "Financial reporting"],
    icon: CircleDollarSign,
    accent: "var(--primary)",
    glow: "rgba(15,185,111,.08)",
  },
  {
    name: "POS",
    label: "Sales at the counter",
    description: "Serve customers efficiently with a point-of-sale workflow connected to your inventory and sales records.",
    items: ["Fast checkout", "Stock-aware selling", "Sales tracking"],
    icon: ShoppingCart,
    accent: "var(--primary)",
    glow: "rgba(15,185,111,.08)",
  },
  {
    name: "Manufacturing",
    label: "Production operations",
    description: "Bring production planning, materials, work orders, and operational visibility into the same system.",
    items: ["Production planning", "Bill of materials", "Work-order tracking"],
    icon: Factory,
    accent: "var(--primary)",
    glow: "rgba(15,185,111,.08)",
  },
  {
    name: "Procurement",
    label: "Purchasing & suppliers",
    description: "Organize requisitions, approvals, purchase orders, and supplier records with a more connected process.",
    items: ["Requisitions & approvals", "Purchase orders", "Supplier management"],
    icon: PackageCheck,
    accent: "var(--primary)",
    glow: "rgba(15,185,111,.08)",
  },
  {
    name: "HRM",
    label: "People & workforce",
    description: "Keep employee information and key workforce workflows together, with access shaped by assigned roles.",
    items: ["Employee records", "Leave & attendance", "Payroll workflows"],
    icon: Users,
    accent: "var(--primary)",
    glow: "rgba(15,185,111,.08)",
  },
]

const navLinks = [
  { label: "Modules", href: "#modules" },
  { label: "How it works", href: "#platform" },
  { label: "Pricing", href: "/login" },
  { label: "Enterprise", href: "#enterprise" },
]

function BrandMark() {
  return (
    <a href="/" className="group inline-flex items-center gap-3" aria-label="Omega Solutions home">
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-primary shadow-[0_0_28px_rgba(15,185,111,.07)]">
        <Boxes className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-white sm:text-base">
        Omega <span className="text-slate-400">Solutions</span>
      </span>
    </a>
  )
}

function DashboardPreview() {
  const bars = [30, 44, 38, 56, 48, 69, 60, 77, 71, 88, 79, 96]
  return (
    <div className="relative mx-auto w-full max-w-[660px]">
      <div className="absolute -inset-8 rounded-[2.5rem] bg-gradient-to-br from-primary/20 via-primary/10 to-transparent blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.11] bg-[#302D2B]/95 shadow-[0_28px_100px_rgba(0,0,0,.55)]">
        <div className="flex h-12 items-center justify-between border-b border-white/[0.07] px-4 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/[0.08] text-primary"><Boxes className="h-3.5 w-3.5" /></span>
            <span className="text-[11px] font-semibold text-slate-200">Omega <span className="text-slate-500">Workspace</span></span>
          </div>
          <div className="hidden items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[10px] text-slate-500 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Workspace overview
          </div>
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">O</div>
        </div>
        <div className="grid min-h-[330px] grid-cols-[108px_1fr] sm:grid-cols-[142px_1fr]">
          <aside className="border-r border-white/[0.06] bg-[#000000]/70 p-2.5 sm:p-3.5">
            <p className="mb-3 px-2 text-[8px] font-semibold uppercase tracking-[.18em] text-slate-600">Workspace</p>
            {[
              ["Overview", BarChart3],
              ["Customers", HeartHandshake],
              ["Sales & POS", ShoppingCart],
              ["Inventory", Boxes],
              ["Finance", Wallet],
              ["People", Users],
            ].map(([label, Icon], index) => {
              const ItemIcon = Icon as typeof BarChart3
              return (
                <div key={label as string} className={`mb-1 flex items-center gap-2 rounded-lg px-2 py-2 text-[9px] ${index === 0 ? "bg-primary/[0.08] font-medium text-primary" : "text-slate-500"}`}>
                  <ItemIcon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{label as string}</span>
                </div>
              )
            })}
            <div className="mt-5 rounded-lg border border-white/[0.06] bg-white/[0.025] p-2">
              <div className="mb-1.5 h-1.5 w-12 rounded bg-white/10" />
              <div className="h-1 w-full rounded bg-white/[0.06]" />
              <div className="mt-1 h-1 w-2/3 rounded bg-white/[0.06]" />
            </div>
          </aside>
          <div className="min-w-0 p-3 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-2">
              <div><p className="text-[13px] font-semibold text-white sm:text-sm">Business overview</p><p className="mt-1 text-[9px] text-slate-500">A connected view of your operations</p></div>
              <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[8px] text-slate-400">This month <ChevronDown className="ml-1 inline h-3 w-3" /></span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Sales", value: "Overview", icon: BarChart3, color: "var(--primary)" },
                { label: "Receivables", value: "Tracked", icon: CircleDollarSign, color: "var(--primary)" },
                { label: "Inventory", value: "Connected", icon: Boxes, color: "var(--primary)" },
                { label: "Workforce", value: "Organized", icon: Users, color: "var(--primary)" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-white/[0.07] bg-[#302D2B] p-2.5 sm:p-3">
                  <stat.icon className="mb-2 h-3.5 w-3.5" style={{ color: stat.color }} />
                  <p className="text-[8px] text-slate-500">{stat.label}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-200 sm:text-xs">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-[#302D2B] p-3 sm:p-4">
              <div className="flex items-center justify-between"><div><p className="text-[10px] font-medium text-slate-200">Operations at a glance</p><p className="mt-1 text-[8px] text-slate-500">Illustrative dashboard preview</p></div><span className="rounded-md bg-primary/[0.06] px-2 py-1 text-[8px] text-primary">Live-ready design</span></div>
              <div className="mt-4 flex h-[92px] items-end gap-1.5 border-b border-white/[0.07] pb-0.5 sm:h-[110px] sm:gap-2">
                {bars.map((height, index) => <div key={index} className="group relative flex-1 rounded-t-sm bg-gradient-to-t from-primary/40 to-chart-4/80 transition-opacity hover:opacity-70" style={{ height: `${height}%` }} />)}
              </div>
              <div className="mt-2 flex justify-between text-[7px] text-slate-600"><span>Week 01</span><span>Week 02</span><span>Week 03</span><span>Week 04</span></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/[0.07] bg-[#302D2B] p-3"><div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /><span className="text-[9px] text-slate-400">Connected modules</span></div><div className="mt-2 flex gap-1.5">{modules.map((module) => <span key={module.name} className="h-1.5 flex-1 rounded-full" style={{ background: module.accent }} />)}</div></div>
              <div className="rounded-xl border border-white/[0.07] bg-[#302D2B] p-3"><div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-primary" /><span className="text-[9px] text-slate-400">Access-aware workflows</span></div><p className="mt-2 text-[9px] text-slate-300">Roles and permissions</p></div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-3 hidden items-center gap-3 rounded-xl border border-white/[0.1] bg-[#302D2B]/95 px-4 py-3 shadow-2xl backdrop-blur sm:flex">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/[0.06] text-primary"><ShieldCheck className="h-4 w-4" /></span>
        <div><p className="text-[10px] font-semibold text-white">One connected platform</p><p className="mt-0.5 text-[9px] text-slate-500">Workflows across your business</p></div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen overflow-hidden bg-[#000000] text-white selection:bg-primary/20 selection:text-white">
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#000000]/85 backdrop-blur-xl">
        <nav className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10" aria-label="Main navigation">
          <BrandMark />
          <div className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => <a key={link.label} href={link.href} className="text-[13px] text-slate-400 transition-colors hover:text-white">{link.label}</a>)}
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <a href="/login" className="rounded-xl border border-white/[0.12] px-4 py-2.5 text-[12px] font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.04]">Sign In</a>
            <a href="/accept-invitation" className="group inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[12px] font-semibold text-white shadow-[0_0_28px_rgba(15,185,111,.08)] transition hover:bg-primary">Get Started <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></a>
          </div>
          <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-slate-200 md:hidden" aria-label={mobileMenuOpen ? "Close menu" : "Open menu"} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </nav>
        {mobileMenuOpen && <div className="border-t border-white/[0.06] bg-[#000000] px-5 py-4 md:hidden"><div className="flex flex-col gap-1">{navLinks.map((link) => <a key={link.label} href={link.href} onClick={() => setMobileMenuOpen(false)} className="rounded-lg px-3 py-3 text-sm text-slate-300 hover:bg-white/[0.04]">{link.label}</a>)}<div className="mt-2 grid grid-cols-2 gap-2"><a href="/login" className="rounded-xl border border-white/10 px-3 py-3 text-center text-sm">Sign In</a><a href="/accept-invitation" className="rounded-xl bg-primary px-3 py-3 text-center text-sm font-semibold text-white">Get Started</a></div></div></div>}
      </header>

      <main>
        <section id="platform" className="relative isolate">
          <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-[18%] -z-10 h-[430px] w-[430px] rounded-full bg-primary/[0.07] blur-[120px]" />
          <div aria-hidden="true" className="pointer-events-none absolute right-[-8%] top-16 -z-10 h-[420px] w-[420px] rounded-full bg-primary/[0.06] blur-[125px]" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-24 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12 lg:px-10 lg:pb-32 lg:pt-28">
            <div className="relative z-10 max-w-2xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-primary/[0.06] px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[.18em] text-primary"><Sparkles className="h-3.5 w-3.5" /> One platform. Connected operations.</div>
              <h1 className="text-[clamp(2.8rem,5.5vw,5.1rem)] font-semibold leading-[1.02] tracking-[-0.065em] text-white">The Operating System for <span className="text-primary">Modern Enterprise.</span></h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-slate-400 sm:text-lg sm:leading-8">Bring CRM, Finance, POS, Manufacturing, Procurement, and HRM together in one connected ERP—so your people, processes, and business information move in sync.</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a href="/accept-invitation" className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-[0_0_34px_rgba(15,185,111,.10)] transition hover:-translate-y-0.5 hover:bg-primary">Get Started <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></a>
                <a href="#modules" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.025] px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.05]"><Play className="h-4 w-4 fill-current" /> Explore the platform</a>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-[11px] text-slate-500"><span className="inline-flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Connected business workflows</span><span className="inline-flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Role-aware access</span></div>
            </div>
            <div className="relative lg:pl-2"><DashboardPreview /></div>
          </div>
          <div className="border-y border-white/[0.06] bg-[#302D2B]/45">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-7 gap-y-4 px-5 py-5 sm:gap-x-10 sm:px-8 lg:justify-between lg:px-10">
              {modules.map((module) => <a key={module.name} href="#modules" className="group inline-flex items-center gap-2 text-[11px] font-medium text-slate-400 transition hover:text-white"><module.icon className="h-4 w-4" style={{ color: module.accent }} />{module.name}</a>)}
            </div>
          </div>
        </section>

        <section id="modules" className="relative py-24 sm:py-28">
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/3 -z-0 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/[0.06] blur-[100px]" />
          <div className="relative mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="mx-auto mb-14 max-w-2xl text-center sm:mb-16">
              <p className="text-[11px] font-semibold uppercase tracking-[.24em] text-primary">One platform. Many capabilities.</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">Every part of your business, <span className="text-slate-500">working together.</span></h2>
              <p className="mt-5 text-sm leading-7 text-slate-400 sm:text-base">Replace disconnected tools and scattered information with business workflows designed to connect across teams.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {modules.map((module) => (
                <article key={module.name} className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#302D2B] p-6 transition duration-300 hover:-translate-y-1 hover:border-white/[0.14] sm:p-7">
                  <span className="absolute inset-x-0 top-0 h-[2px] opacity-80 transition-opacity group-hover:opacity-100" style={{ background: module.accent }} />
                  <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-100" style={{ background: module.glow }} />
                  <div className="relative flex items-start justify-between gap-4">
                    <span className="grid h-12 w-12 place-items-center rounded-xl border" style={{ color: module.accent, backgroundColor: module.glow, borderColor: module.accent + "35" }}><module.icon className="h-5 w-5" /></span>
                    <span className="rounded-full border border-white/[0.07] px-2.5 py-1 text-[9px] uppercase tracking-[.12em] text-slate-500">Integrated module</span>
                  </div>
                  <p className="relative mt-6 text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: module.accent }}>{module.label}</p>
                  <h3 className="relative mt-2 text-xl font-semibold tracking-tight text-white">{module.name}</h3>
                  <p className="relative mt-3 min-h-[72px] text-sm leading-6 text-slate-400">{module.description}</p>
                  <ul className="relative mt-5 space-y-2.5 border-t border-white/[0.07] pt-5">
                    {module.items.map((item) => <li key={item} className="flex items-center gap-2.5 text-xs text-slate-300"><Check className="h-3.5 w-3.5 shrink-0" style={{ color: module.accent }} />{item}</li>)}
                  </ul>
                  <a href="/login" className="relative mt-6 inline-flex items-center gap-2 text-xs font-semibold transition group-hover:gap-3" style={{ color: module.accent }}>Explore {module.name} <ArrowRight className="h-3.5 w-3.5" /></a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="enterprise" className="border-y border-white/[0.06] bg-[#302D2B]/55 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[.24em] text-primary">Built for connected operations</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-white sm:text-4xl">A clearer view of the whole business.</h2>
              <p className="mt-4 text-sm leading-7 text-slate-400 sm:text-base">Bring essential teams and processes into one system, with the structure to support the way your business operates.</p>
            </div>
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { number: "6", suffix: "", title: "Core capabilities", note: "Connected business modules", icon: Boxes, color: "var(--primary)" },
                { number: "1", suffix: "", title: "Shared platform", note: "A more connected workflow", icon: Globe2, color: "var(--primary)" },
                { number: "360°", suffix: "", title: "Business visibility", note: "Information across teams", icon: BarChart3, color: "var(--primary)" },
                { number: "24/7", suffix: "", title: "Access when needed", note: "A web-based workspace", icon: ShieldCheck, color: "var(--primary)" },
              ].map((stat) => <div key={stat.title} className="rounded-2xl border border-white/[0.07] bg-[#000000]/55 p-6 text-center sm:p-7"><stat.icon className="mx-auto h-5 w-5" style={{ color: stat.color }} /><p className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-white">{stat.number}{stat.suffix}</p><p className="mt-2 text-sm font-semibold text-slate-200">{stat.title}</p><p className="mt-1.5 text-xs text-slate-500">{stat.note}</p></div>)}
            </div>
            <p className="mt-5 text-center text-[10px] text-slate-600">Platform capability indicators, not customer-count or uptime claims.</p>
          </div>
        </section>

        <section className="px-5 py-20 sm:px-8 sm:py-28 lg:px-10">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl border border-white/[0.09] bg-[#302D2B] px-6 py-12 sm:px-12 sm:py-16 lg:px-16">
            <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-36 h-96 w-96 rounded-full bg-primary/[0.06] blur-[100px]" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-44 left-1/3 h-80 w-80 rounded-full bg-primary/[0.06] blur-[100px]" />
            <div className="relative flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
              <div className="max-w-2xl"><span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-primary"><Building2 className="h-3.5 w-3.5" /> Your business. Better connected.</span><h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white sm:text-4xl">One platform for your business.</h2><p className="mt-4 max-w-xl text-sm leading-7 text-slate-400 sm:text-base">Bring your teams, workflows, and business information together with Omega Solutions.</p></div>
              <a href="/accept-invitation" className="group inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-white shadow-[0_0_35px_rgba(15,185,111,.08)] transition hover:-translate-y-0.5 hover:bg-primary">Get Started <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] bg-[#000000]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
          <BrandMark />
          <p className="text-xs text-slate-600">One platform for your business.</p>
          <div className="flex items-center gap-5 text-xs text-slate-500"><a href="#modules" className="transition hover:text-white">Modules</a><a href="/login" className="transition hover:text-white">Sign in</a><a href="#platform" className="inline-flex items-center gap-1 transition hover:text-white">Back to top <ArrowDownRight className="h-3 w-3 -rotate-45" /></a></div>
        </div>
      </footer>
    </div>
  )
}
