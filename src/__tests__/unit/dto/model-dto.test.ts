import { describe, it, expect } from "@jest/globals";
import {
  ModelCreateInputDTO,
  ModelUpdateInputDTO,
} from "../../../dto/input/model";

/**
 * SECURITY regression: `models.code` is varchar(100). An over-long code used to
 * reach Postgres and raise 22001 string_data_right_truncation, whose message
 * knex prefixes with `insert into "models" (...)`. The DTO now rejects it, so
 * the SQLSTATE is unreachable from this endpoint.
 */
const validBody = (overrides: Record<string, unknown> = {}) => ({
  code: "M-001",
  description: "Caja regular",
  ...overrides,
});

describe("Model DTO code length", () => {
  it("accepts a code of exactly the column limit", () => {
    const dto = new ModelCreateInputDTO(
      validBody({ code: "x".repeat(100) }),
    ).build();

    expect(dto.code).toHaveLength(100);
  });

  it("rejects a create with a code longer than the column limit", () => {
    expect(() =>
      new ModelCreateInputDTO(validBody({ code: "x".repeat(101) })).build(),
    ).toThrow(/code cannot be longer than 100 characters/i);
  });

  it("rejects an update with a code longer than the column limit", () => {
    expect(() =>
      new ModelUpdateInputDTO({ code: "x".repeat(200) }).build(),
    ).toThrow(/code cannot be longer than 100 characters/i);
  });
});
