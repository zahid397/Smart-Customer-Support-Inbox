import "@testing-library/jest-dom";

// jsdom doesn't implement scrollTo
Element.prototype.scrollTo = jest.fn();

// Stable localStorage mock
const store = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
  },
  writable: true,
});
