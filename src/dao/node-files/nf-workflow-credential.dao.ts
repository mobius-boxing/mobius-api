import { db } from "../../database/registry";

const TABLE = "nf_workflow_credentials";

/**
 * Which credentials a workflow uses — the one relation hiding inside the
 * `definition` jsonb, pulled out into a table on purpose.
 *
 * The alternative (a GIN index and a jsonb containment query on every
 * credential delete) is exactly the `paper_classes.papers` mistake this repo
 * already paid for once: a jsonb array that was really a relation, migrated
 * into a join table after the fact. The question this table answers —
 * "can I delete this credential?" — is a relational question, so it gets a
 * relational answer.
 *
 * Maintained on workflow save: the rows are REPLACED, not merged, so a node
 * that stops referencing a credential stops holding it hostage immediately.
 */
export class NfWorkflowCredentialDAO {
  /**
   * Replace the whole set for one workflow, in ONE short transaction.
   *
   * Two statements against two rows of the same key, no external I/O: this is
   * the shape the connection rule permits inside a transaction. It lives in a
   * DAO because only `src/dao` and `src/database` may hold a connection.
   */
  async replaceForWorkflow(
    workflowId: number,
    companyId: number,
    credentialIds: number[],
  ): Promise<void> {
    const unique = [...new Set(credentialIds)];
    await db("nodefiles").transaction(async (trx) => {
      await trx(TABLE).where({ workflowId, companyId }).delete();
      if (unique.length === 0) return;
      await trx(TABLE).insert(
        unique.map((credentialId) => ({
          workflowId,
          credentialId,
          companyId,
        })),
      );
    });
  }

  /** The credential ids one workflow references. */
  async idsByWorkflow(
    workflowId: number,
    companyId: number,
  ): Promise<number[]> {
    const rows = await db("nodefiles")(TABLE)
      .where({ workflowId, companyId })
      .select("credentialId");
    return (rows as Array<{ credentialId: number }>).map(
      (row) => row.credentialId,
    );
  }
}
