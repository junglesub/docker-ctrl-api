import { KeyConfig } from "../interface";

export const validateKey = (
  keyData: KeyConfig,
  id: string,
  secretKey: string
) => {
  if (!Object.keys(keyData.keys).includes(id)) return null;
  const entry = keyData.keys[id];
  if (entry.secret_key !== secretKey) return null;
  return entry;
};
