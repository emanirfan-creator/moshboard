// shadcn-style theme tokens so 21st.dev components look right on the dark canvas.
export const TW_THEME = `
@custom-variant dark (&:where(.dark, .dark *));
@theme {
  --color-background: #1b1c1f;
  --color-foreground: #f7f8f8;
  --color-card: #222327;
  --color-card-foreground: #f7f8f8;
  --color-popover: #222327;
  --color-popover-foreground: #f7f8f8;
  --color-primary: #5e6ad2;
  --color-primary-foreground: #ffffff;
  --color-secondary: #26272b;
  --color-secondary-foreground: #f7f8f8;
  --color-muted: #26272b;
  --color-muted-foreground: #8a8f98;
  --color-accent: #26272b;
  --color-accent-foreground: #f7f8f8;
  --color-destructive: #eb5757;
  --color-border: rgba(255,255,255,0.08);
  --color-input: rgba(255,255,255,0.1);
  --color-ring: #5e6ad2;
  --font-sans: "Inter Variable", Inter, system-ui, sans-serif;
}`
