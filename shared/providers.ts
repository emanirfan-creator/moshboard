// Libraries whose components only render inside their provider. A code frame that
// imports one runs inside its preset automatically, with nothing for the designer to do.
// Anything else gets a frames/<id>.wrapper.tsx (written by Claude Code, see copySetupFix).

export interface ProviderPreset {
  name: string
  test: RegExp
  code: string
}

export const PROVIDERS: ProviderPreset[] = [
  {
    name: 'Chakra UI',
    test: /['"]@chakra-ui\/react['"]/,
    code: `import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

export default function Wrapper({ children }: { children: React.ReactNode }) {
  return <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>;
}
`,
  },
  {
    name: 'MUI',
    test: /['"]@mui\/material(\/[^'"]*)?['"]/,
    code: `import { ThemeProvider, createTheme } from "@mui/material/styles";

const theme = createTheme({ palette: { mode: "dark" } });

export default function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
`,
  },
  {
    name: 'Mantine',
    test: /['"]@mantine\/core['"]/,
    code: `import { MantineProvider } from "@mantine/core";

// Mantine's components are unstyled without its stylesheet.
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = "https://esm.sh/@mantine/core/styles.css";
document.head.append(css);

export default function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider defaultColorScheme="dark">{children}</MantineProvider>;
}
`,
  },
]

/** The preset for the first provider-bound library these sources import. */
export const presetFor = (sources: string[]) => PROVIDERS.find((p) => sources.some((s) => p.test.test(s)))
