const store: Record<string, string> = {};
export default {
  getItem:    jest.fn(async (k: string) => store[k] ?? null),
  setItem:    jest.fn(async (k: string, v: string) => { store[k] = v; }),
  removeItem: jest.fn(async (k: string) => { delete store[k]; }),
  clear:      jest.fn(async () => { Object.keys(store).forEach(k => delete store[k]); }),
};
