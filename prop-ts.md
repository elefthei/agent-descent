Shifting from a serializable graph object to a Domain Specific Language (DSL) means moving towards a **functional combinator pattern**. This approach is incredibly elegant and powerful, especially when your rules engine needs to evaluate propositional logic with a ternary state (often called Kleene logic, where continue acts as "unknown", "defer", or "pass").

In this architecture, your "nodes" are no longer static objects; they are higher-order functions.

Here is how you can build a strongly-typed, composable DSL in TypeScript for the A \-\> Tri operation pattern.

### **1\. The Core Types**

First, we define our ternary state and the base rule signature. Using a const enum or union type works best here.

TypeScript

export type Tri \= 'SUCCESS' | 'FAILURE' | 'CONTINUE';

// This is the A \-\> Tri base operation.   
// We use a generic \<A\> to represent the context or payload being evaluated.  
export type Rule\<A\> \= (context: A) \=\> Tri;

### **2\. The Propositional Logic Combinators (The DSL)**

The power of this approach comes from combinators: functions that take Rule\<A\> functions as arguments and return a new Rule\<A\>.

The most important design decision here is how AND and OR handle the CONTINUE state.

TypeScript

/\*\*  
 \* AND Combinator  
 \* \- If ANY rule fails, the whole block FAILS.  
 \* \- If ALL rules succeed, the whole block SUCCEEDS.  
 \* \- If no rules fail, but at least one yields CONTINUE, the block CONTINUES.  
 \*/  
export const and \= \<A\>(...rules: Rule\<A\>\[\]): Rule\<A\> \=\> (ctx: A) \=\> {  
  let hasContinue \= false;  
    
  for (const rule of rules) {  
    const result \= rule(ctx);  
    if (result \=== 'FAILURE') return 'FAILURE'; // Short-circuit  
    if (result \=== 'CONTINUE') hasContinue \= true;  
  }  
    
  return hasContinue ? 'CONTINUE' : 'SUCCESS';  
};

/\*\*  
 \* OR Combinator  
 \* \- If ANY rule succeeds, the whole block SUCCEEDS.  
 \* \- If ALL rules fail, the whole block FAILS.  
 \* \- If no rules succeed, but at least one yields CONTINUE, the block CONTINUES.  
 \*/  
export const or \= \<A\>(...rules: Rule\<A\>\[\]): Rule\<A\> \=\> (ctx: A) \=\> {  
  let hasContinue \= false;  
    
  for (const rule of rules) {  
    const result \= rule(ctx);  
    if (result \=== 'SUCCESS') return 'SUCCESS'; // Short-circuit  
    if (result \=== 'CONTINUE') hasContinue \= true;  
  }  
    
  return hasContinue ? 'CONTINUE' : 'FAILURE';  
};

/\*\*  
 \* NOT Combinator  
 \* \- Inverts SUCCESS and FAILURE.   
 \* \- CONTINUE remains CONTINUE (the inverse of an unknown is still unknown).  
 \*/  
export const not \= \<A\>(rule: Rule\<A\>): Rule\<A\> \=\> (ctx: A) \=\> {  
  const result \= rule(ctx);  
  if (result \=== 'SUCCESS') return 'FAILURE';  
  if (result \=== 'FAILURE') return 'SUCCESS';  
  return 'CONTINUE';  
};

### **3\. Primitive Builders and Leaf Nodes**

To make the DSL ergonomic, you write utility functions that generate the leaf-node operations.

TypeScript

// A utility to bridge standard booleans into our Tri logic  
export const fromBool \= (condition: boolean): Tri \=\>   
  condition ? 'SUCCESS' : 'FAILURE';

// Primitive builder: Creates a rule that checks a specific property  
export const propEq \= \<A, K extends keyof A\>(key: K, value: A\[K\]): Rule\<A\> \=\>   
  (ctx: A) \=\> fromBool(ctx\[key\] \=== value);

// A rule that explicitly defers evaluation to the next stage in a pipeline  
export const defer \= \<A\>(): Rule\<A\> \=\> () \=\> 'CONTINUE';

### **4\. Putting it Together**

Because everything is just a function returning a function, the usage looks exactly like a declarative language.

TypeScript

// Define the Context type (A)  
interface Transaction {  
  amount: number;  
  country: string;  
  isFlagged: boolean;  
  userScore?: number;  
}

// 1\. Define custom base operations  
const isHighValue: Rule\<Transaction\> \= (tx) \=\> fromBool(tx.amount \> 10000);  
const isDomestic: Rule\<Transaction\> \= propEq('country', 'US');  
const isFlagged: Rule\<Transaction\> \= propEq('isFlagged', true);

const checkUserScore: Rule\<Transaction\> \= (tx) \=\> {  
  if (tx.userScore \=== undefined) return 'CONTINUE'; // Need more info, defer  
  return fromBool(tx.userScore \> 80);  
};

// 2\. Compose them using the DSL combinators  
const evaluationTree \= or(  
  and(isDomestic, not(isFlagged)),  
  and(isHighValue, checkUserScore)  
);

// 3\. Execute  
const tx1: Transaction \= { amount: 15000, country: 'FR', isFlagged: false };  
const result \= evaluationTree(tx1);   
// Output: 'CONTINUE' (Because checkUserScore lacks data and returns CONTINUE)

### **Why this approach is excellent:**

1. **Extreme Extensibility:** You can create custom combinators easily. For example, a sequence(...) combinator that runs rules in order and stops at the first SUCCESS, or a threshold(count, ...rules) combinator that requires $N$ rules to succeed.  
2. **Zero Overhead Composition:** Because they are closures, you don't need a heavy engine to parse an AST (Abstract Syntax Tree) at runtime. V8/JS engines optimize these higher-order function chains incredibly well.  
3. **Type Inference:** TypeScript natively understands that tx inside your rules is a Transaction without any extra mapping layers.