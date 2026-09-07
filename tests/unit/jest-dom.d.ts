// Makes the jest-dom matcher types (toHaveTextContent, toBeInTheDocument, ...) visible to `tsc`.
// The runtime registration happens in tests/setup.ts (vitest setupFiles), which is outside the tsconfig program.
import '@testing-library/jest-dom/vitest';
