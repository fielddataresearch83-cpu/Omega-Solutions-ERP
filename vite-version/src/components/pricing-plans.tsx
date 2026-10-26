"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Sparkles, Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface PricingPlan {
  id: string
  name: string
  description: string
  price: string
  frequency: string
  features: string[]
  popular?: boolean
  current?: boolean
  customPricing?: boolean
}

interface PricingPlansProps {
  plans?: PricingPlan[]
  mode?: "pricing" | "billing"
  currentPlanId?: string
  onPlanSelect?: (planId: string) => void
}

const defaultPlans: PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Essential sales and stock control for small businesses",
    price: "KSh 1,500",
    frequency: "/month",
    features: ["Inventory and stock tracking", "Sales, POS and invoicing", "Basic business reports", "2 users", "1 branch", "Standard online support"],
  },
  {
    id: "medium",
    name: "Medium",
    description: "Connected tools for growing businesses",
    price: "KSh 3,000",
    frequency: "/month",
    features: ["Everything in Starter", "Finance and accounting", "Procurement and approvals", "CRM and customer management", "5 users", "Up to 3 branches"],
  },
  {
    id: "professional",
    name: "Professional",
    description: "Broader operational control for established businesses",
    price: "KSh 6,000",
    frequency: "/month",
    features: ["Everything in Medium", "Manufacturing and production", "HR and workforce management", "Expanded operational reports", "15 users", "Up to 5 branches"],
    popular: true,
  },
  {
    id: "enterprise_custom",
    name: "Enterprise",
    description: "Tailored ERP for complex and multi-entity organisations",
    price: "Custom quote",
    frequency: "",
    customPricing: true,
    features: ["Configurable modules and workflows", "Agreed user and branch limits", "Custom integrations and onboarding", "Migration and implementation scope", "Agreed support arrangements"],
  },
]

export function PricingPlans({
  plans = defaultPlans,
  mode = "pricing",
  currentPlanId,
  onPlanSelect,
}: PricingPlansProps) {
  const getButtonText = (plan: PricingPlan) => {
    if (mode === "billing") {
      if (currentPlanId === plan.id) return "Current Plan"
      if (plan.customPricing) return "Request a quote"
      const currentIndex = plans.findIndex((p) => p.id === currentPlanId)
      const planIndex = plans.findIndex((p) => p.id === plan.id)
      if (currentIndex >= 0 && planIndex > currentIndex) return "Request upgrade"
      if (currentIndex >= 0 && planIndex < currentIndex) return "Request downgrade"
      return "Request plan"
    }
    return plan.customPricing ? "Request a quote" : "Get Started"
  }

  const getButtonVariant = (plan: PricingPlan) => {
    if (mode === "billing" && currentPlanId === plan.id) return "outline" as const
    return plan.popular ? ("default" as const) : ("outline" as const)
  }

  const isButtonDisabled = (plan: PricingPlan) =>
    mode === "billing" && currentPlanId === plan.id

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {plans.map((tier) => (
        <Card
          key={tier.id}
          className={cn(
            "flex flex-col overflow-visible pt-0 shadow-xs [--card-spacing:--spacing(6)]",
            {
              "relative shadow-lg ring-primary": tier.popular,
              "ring-primary": currentPlanId === tier.id && mode === "billing",
            }
          )}
          aria-labelledby={`${tier.id}-title`}
        >
          {tier.popular && (
            <div className="absolute start-0 -top-3 w-full">
              <Badge className="mx-auto flex w-fit gap-1.5 rounded-full font-medium">
                <Sparkles className="size-4!" />
                {mode === "pricing" && <span>Recommended</span>}
                {currentPlanId === tier.id && mode === "billing" && <span>Current Plan</span>}
              </Badge>
            </div>
          )}
          <CardHeader className="gap-y-2 pt-8 text-center">
            <CardTitle id={`${tier.id}-title`} className="text-2xl font-semibold">{tier.name}</CardTitle>
            <p className="text-muted-foreground text-sm text-balance">{tier.description}</p>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-6">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-3xl font-bold">{tier.price}</span>
              <span className="text-muted-foreground text-sm">{tier.frequency}</span>
            </div>
            <div className="flex flex-col gap-2">
              {tier.features.map((feature) => (
                <div key={feature} className="flex items-center gap-2">
                  <div className="bg-muted rounded-full p-1"><Check className="size-3.5" /></div>
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="border-t-0 bg-transparent pt-0">
            <Button
              className="w-full cursor-pointer"
              size="lg"
              variant={getButtonVariant(tier)}
              disabled={isButtonDisabled(tier)}
              onClick={() => {
                if (mode === "pricing" && tier.customPricing) {
                  window.location.assign("/contact")
                  return
                }
                onPlanSelect?.(tier.id)
              }}
              aria-label={`${getButtonText(tier)} - ${tier.name} plan`}
            >
              {getButtonText(tier)}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
