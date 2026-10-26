"use client"

import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const plans = [
  {
    name: "Starter",
    description: "Essential sales and stock control for small businesses",
    monthlyPrice: 1500,
    features: ["Inventory and stock tracking", "Sales, POS and invoicing", "Basic business reports", "2 users", "1 branch"],
    popular: false,
  },
  {
    name: "Medium",
    description: "Connected operations for growing businesses",
    monthlyPrice: 3000,
    features: ["Everything in Starter", "Finance and accounting", "Procurement and approvals", "CRM", "5 users", "Up to 3 branches"],
    popular: true,
  },
  {
    name: "Professional",
    description: "Broader operational control for established businesses",
    monthlyPrice: 6000,
    features: ["Everything in Medium", "Manufacturing and production", "HR and workforce management", "Expanded operational reports", "15 users", "Up to 5 branches"],
    popular: false,
  },
  {
    name: "Enterprise",
    description: "Tailored ERP for complex organisations",
    monthlyPrice: 0,
    features: ["Configurable modules and workflows", "Custom integrations and onboarding", "Agreed user and branch limits", "Implementation and migration scope", "Agreed support arrangements"],
    popular: false,
    custom: true,
  },
]

export function PricingSection() {
  return (
    <section id="pricing" className="py-24 sm:py-32 bg-muted/40">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-12">
          <Badge variant="outline" className="mb-4">Omega Solutions pricing</Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">The right ERP plan for your business</h2>
          <p className="text-lg text-muted-foreground mb-8">
            Start with sales and stock, then add connected finance, customer management, manufacturing and workforce tools as your business grows.
          </p>
        </div>
        <div className="mx-auto max-w-6xl">
          <div className="rounded-xl border">
            <div className="grid lg:grid-cols-3">
              {plans.map((plan) => (
                <div key={plan.name} className={`p-8 flex flex-col gap-6 ${plan.popular ? "my-2 mx-4 rounded-xl bg-card shadow-xl ring-1 ring-foreground/10" : ""}`}>
                  <div>
                    <div className="text-lg font-medium tracking-tight mb-2">{plan.name}</div>
                    <div className="text-muted-foreground text-balance text-sm">{plan.description}</div>
                  </div>
                  <div>
                    <div className="text-4xl font-bold mb-1">KSh {plan.monthlyPrice.toLocaleString("en-KE")}</div>
                    <div className="text-muted-foreground text-sm">Per month</div>
                  </div>
                  <div>
                    <Button className="w-full" variant={plan.popular ? "default" : "secondary"} onClick={() => window.location.assign("/pricing")}>View plan</Button>
                  </div>
                  <ul role="list" className="flex flex-col gap-3 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-3">
                        <Check className="text-muted-foreground size-4 flex-shrink-0" strokeWidth={2.5} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-12 text-center text-sm text-muted-foreground">Prices are in Kenyan shillings and billed monthly. Payment-provider fees, custom integrations and hands-on implementation may be priced separately.</div>
      </div>
    </section>
  )
}
