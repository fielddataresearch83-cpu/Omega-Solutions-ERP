import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { SidebarConfigProvider } from "@/contexts/sidebar-context"
import { AuthProvider } from "@/contexts/auth-context"
import { Toaster } from "@/components/ui/toast"
import { RootErrorBoundary, RootFallback, RootLayout } from "@/components/router/root-layout"
import { routes } from "@/config/routes"
import { useEffect } from "react"
import { initGTM } from "@/utils/analytics"

// Get basename from environment (for deployment) or use empty string for development
const basename = import.meta.env.VITE_BASENAME || ""

const router = createBrowserRouter(
  [
    {
      element: <RootLayout />,
      ErrorBoundary: RootErrorBoundary,
      HydrateFallback: RootFallback,
      children: routes,
    },
  ],
  { basename }
)

function App() {
  // Initialize GTM on app load
  useEffect(() => {
    initGTM()
  }, [])

  return (
    <div
      className="font-sans antialiased"
      style={{ fontFamily: "var(--font-inter)" }}
    >
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <AuthProvider>
          <SidebarConfigProvider>
            <Toaster>
              <RouterProvider router={router} />
            </Toaster>
          </SidebarConfigProvider>
        </AuthProvider>
      </ThemeProvider>
    </div>
  )
}

export default App
