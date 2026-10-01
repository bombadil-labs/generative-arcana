import { types, type CustomTypesConfig } from "pg";

// pg normally returns int8 as strings. Better Auth 1.7.7 normalizes bigint
// timestamps, but not strings, before calculating its X-Retry-After duration.
// Keep this lossless parser local to the auth pool; never change global parsers
// or narrow the database's millisecond timestamp column to a 32-bit integer.
export const AUTH_POSTGRES_TYPES: CustomTypesConfig = {
  getTypeParser(oid, format) {
    if (oid === types.builtins.INT8 && format !== "binary") return BigInt;
    return types.getTypeParser(oid, format);
  },
};
