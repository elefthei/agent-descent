/**
 * Propositional logic DSL for gatekeeper and terminator rules.
 * Ternary (Kleene) logic: SUCCESS | FAILURE | CONTINUE.
 *
 * Usage:
 *   import { Gate, type Tri, type Rule } from "./rules.js";
 *   const rule = Gate.and(ruleA, Gate.or(ruleB, ruleC), Gate.not(ruleD));
 *   const result: Tri = rule(context);
 */

export type Tri = "SUCCESS" | "FAILURE" | "CONTINUE";

export type Rule<A> = (ctx: A) => Tri;

export const Gate = {
    /**
     * AND: FAILURE if any fails, SUCCESS if all succeed, CONTINUE otherwise.
     */
    and<A>(...rules: Rule<A>[]): Rule<A> {
        return (ctx: A) => {
            let hasContinue = false;
            for (const rule of rules) {
                const result = rule(ctx);
                if (result === "FAILURE") return "FAILURE";
                if (result === "CONTINUE") hasContinue = true;
            }
            return hasContinue ? "CONTINUE" : "SUCCESS";
        };
    },

    /**
     * OR: SUCCESS if any succeeds, FAILURE if all fail, CONTINUE otherwise.
     */
    or<A>(...rules: Rule<A>[]): Rule<A> {
        return (ctx: A) => {
            let hasContinue = false;
            for (const rule of rules) {
                const result = rule(ctx);
                if (result === "SUCCESS") return "SUCCESS";
                if (result === "CONTINUE") hasContinue = true;
            }
            return hasContinue ? "CONTINUE" : "FAILURE";
        };
    },

    /**
     * NOT: inverts SUCCESS↔FAILURE, CONTINUE stays CONTINUE.
     */
    not<A>(rule: Rule<A>): Rule<A> {
        return (ctx: A) => {
            const result = rule(ctx);
            if (result === "SUCCESS") return "FAILURE";
            if (result === "FAILURE") return "SUCCESS";
            return "CONTINUE";
        };
    },

    /**
     * Bridge a boolean into Tri.
     */
    fromBool(condition: boolean): Tri {
        return condition ? "SUCCESS" : "FAILURE";
    },

    /**
     * Always returns CONTINUE — defer to next evaluation.
     */
    defer<A>(): Rule<A> {
        return () => "CONTINUE";
    },
};
