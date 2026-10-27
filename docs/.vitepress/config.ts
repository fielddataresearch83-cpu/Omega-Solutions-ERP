import { defineConfig } from 'vitepress'

export default defineConfig({
  // Dev-server URLs like http://localhost:3000 are instructions, not pages
  ignoreDeadLinks: "localhostLinks",
  title: 'Omega Solutions',
  description: 'Omega Solutions — One platform for your business.',

  // Theme configuration
  themeConfig: {
    logo: '/logo.svg',

    // Navigation menu
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Vite Version', link: '/vite/' },
      { text: 'Next.js Version', link: '/nextjs/' },
      { text: 'Components', link: '/components/' },
      { text: 'Theme Customizer', link: '/theme-customizer/' }
    ],

    // Sidebar configuration with path-specific sidebars
    sidebar: {
      // Main guide sidebar
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Overview', link: '/guide/' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Choosing Framework', link: '/guide/choosing-framework' }
          ]
        },
        {
          text: 'Template Guide',
          items: [
            { text: 'Features', link: '/guide/features' },
            { text: 'Tech Stack', link: '/guide/tech-stack' },
            { text: 'Project Structure', link: '/guide/project-structure' },
            { text: 'Theme System', link: '/guide/theme-system' }
          ]
        },
        {
          text: 'Community',
          items: [
            { text: 'Contributing', link: '/guide/contributing' },
            { text: 'Support', link: '/guide/support' },
            { text: 'License', link: '/guide/license' }
          ]
        }
      ],

      // Vite version sidebar
      '/vite/': [
        {
          text: 'Vite Version',
          items: [
            { text: 'Overview', link: '/vite/' },
            { text: 'Quick Start', link: '/vite/quick-start' },
            { text: 'Development', link: '/vite/development' },
            { text: 'Build & Deploy', link: '/vite/build-deploy' },
            { text: 'Troubleshooting', link: '/vite/troubleshooting' }
          ]
        }
      ],

      // Next.js version sidebar
      '/nextjs/': [
        {
          text: 'Next.js Version',
          items: [
            { text: 'Overview', link: '/nextjs/' },
            { text: 'Quick Start', link: '/nextjs/quick-start' },
            { text: 'Development', link: '/nextjs/development' },
            { text: 'Build & Deploy', link: '/nextjs/build-deploy' },
            { text: 'Troubleshooting', link: '/nextjs/troubleshooting' }
          ]
        }
      ],

      // Components sidebar
      '/components/': [
        {
          text: 'Component Library',
          items: [
            { text: 'Overview', link: '/components/' },
            { text: 'shadcn/ui Integration', link: '/components/shadcn-ui' },
            { text: 'Data Tables', link: '/components/data-tables' },
            { text: 'Charts', link: '/components/charts' },
            { text: 'Custom Components', link: '/components/custom-components' }
          ]
        }
      ],

      // Theme customizer sidebar
      '/theme-customizer/': [
        {
          text: 'Theme Customizer',
          items: [
            { text: 'Overview', link: '/theme-customizer/' },
            { text: 'Configuration', link: '/theme-customizer/configuration' },
            { text: 'Custom Themes', link: '/theme-customizer/custom-themes' },
            { text: 'Removing Customizer', link: '/theme-customizer/removing-customizer' }
          ]
        }
      ]
    },

    // Social links
    socialLinks: [
      { icon: 'github', link: 'https://github.com/shadcnstore/shadcn-dashboard-landing-template' }
    ],

    // Footer
    footer: {
      message: 'One platform for your business.',
      copyright: 'A product of Fezaton Enterprises'
    },

    // Search
    search: {
      provider: 'local'
    },

    // Edit link
    editLink: {
      pattern: 'https://github.com/shadcnstore/shadcn-dashboard-landing-template/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    }
  },

  // Markdown configuration
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true
  },

  // Head configuration
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'shortcut icon', href: '/favicon.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#0D1B2A' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'en' }],
    ['meta', { property: 'og:title', content: 'Shadcn Dashboard + Landing Page Template | React & Next.js Starter Template' }],
    ['meta', { property: 'og:site_name', content: 'ShadcnStore' }],
    ['meta', { property: 'og:image', content: '/og-image.png' }],
    ['meta', { property: 'og:url', content: 'https://shadcnstore.com/templates/dashboard/shadcn-dashboard-landing-template' }]
  ]
})
