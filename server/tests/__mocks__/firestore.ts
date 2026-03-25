export const doc        = jest.fn((_db: any, ...segments: string[]) => ({ path: segments.join('/') }));
export const collection = jest.fn((_db: any, ...segments: string[]) => ({ path: segments.join('/') }));
export const getDoc     = jest.fn();
export const getDocs    = jest.fn();
export const addDoc     = jest.fn();
export const updateDoc  = jest.fn();
export const setDoc     = jest.fn();
export const query      = jest.fn((...args: any[]) => args[0]);
export const where      = jest.fn();
export const orderBy    = jest.fn();
export const Timestamp  = {
  fromDate: (d: Date) => ({ toDate: () => d }),
  now:      () => ({ toDate: () => new Date() }),
};
