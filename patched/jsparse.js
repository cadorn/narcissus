/*
 * Narcissus - JS implemented in JS.
 *
 * Lexical scanner and parser.
 */


// Retrieves only direct and simple properties for the given object.
//
// Due to this being a meta-interpreter, there are some tricky cases:
//
//   keywords['hasOwnProperty']
//   keywords['__proto__']
//
// These should return the fallback!  We don't want the meta-properties.
var getOwnAtomProperty = function (object, key, fallback) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
        var value = object[key];
        // HACK to get rid of __proto__: test that isn't an object
        return (typeof value === 'object') ? fallback : value;
    }
    return fallback;
};

// Build a regexp that recognizes operators and punctuators (except newline).
var opRegExpSrc = "^";
for (var i in opTypeNames) {
    if (i == '\n') {
        continue;
    }
    if (opRegExpSrc != "^") {
        opRegExpSrc += "|^";
    }
    opRegExpSrc += i.replace(/[?|\^&(){}\[\]+\-*\/\.]/g, "\\$&");
}
var opRegExp = new RegExp(opRegExpSrc);

// A regexp to match floating point literals (but not integer literals).
var fpRegExp = /^\d+\.\d*(?:[eE][\-+]?\d+)?|^\d+(?:\.\d*)?[eE][\-+]?\d+|^\.\d+(?:[eE][\-+]?\d+)?/;

// A regexp to match regexp literals.
var reRegExp = /^\/((?:\\.|\[(?:\\.|[^\]])*\]|[^\/])+)\/([gimy]*)/;

var Tokenizer = exports.Tokenizer = function(source, filename, lineno) {
    this.cursor = 0;
    this.source = String(source);
    this.tokens = [];
    this.tokenIndex = 0;
    this.lookahead = 0;
    this.scanNewlines = false;
    this.scanOperand = true;
    this.filename = filename || "";
    this.lineno = lineno || 1;
}

Tokenizer.prototype = {

    input: function() {
        return this.source.substring(this.cursor);
    },

    done: function() {
        return this.peek() == defs.END;
    },

    token: function() {
        return this.tokens[this.tokenIndex];
    },

    match: function (tt) {
        return this.get() == tt || this.unget();
    },

    mustMatch: function (tt) {
        if (!this.match(tt)) {
            throw this.newSyntaxError("Expected " + tokens[tt]);
        }
        return this.token();
    },

    peek: function () {
        var tt, next;
        if (this.lookahead) {
            next = this.tokens[(this.tokenIndex + this.lookahead) & 3];
            if (this.scanNewlines && next.lineno != this.lineno) {
                tt = defs.NEWLINE;
            } else {
                tt = next.type;
            }
        } else {
            tt = this.get();
            this.unget();
        }
        return tt;
    },

    peekOnSameLine: function () {
        this.scanNewlines = true;
        var tt = this.peek();
        this.scanNewlines = false;
        return tt;
    },

    get: function () {
        var token;
        while (this.lookahead) {
            --this.lookahead;
            this.tokenIndex = (this.tokenIndex + 1) & 3;
            token = this.tokens[this.tokenIndex];
            if (token.type != defs.NEWLINE || this.scanNewlines) {
                return token.type;
            }
        }

        var input, match, newlines;
        for (;;) {
            input = this.input();
            if (this.scanNewlines) {
              match = input.match(/^[ \t]+/);
            } else {
              match = input.match(/^\s+/);
            }
            if (match) {
                var spaces = match[0];
                this.cursor += spaces.length;
                newlines = spaces.match(/\n/g);
                if (newlines) {
                    this.lineno += newlines.length;
                }
                input = this.input();
            }

            if (!(match = input.match(/^\/(?:\*(?:.|\n)*?\*\/|\/.*)/))) {
                break;
            }
            var comment = match[0];

            // TODO: EXPOSE COMMENTS, with singleLine: true/false
            // print('GOT COMMENT ' + match[0]);

            this.cursor += comment.length;
            newlines = comment.match(/\n/g);
            if (newlines) {
                this.lineno += newlines.length;
            }
        }

        this.tokenIndex = (this.tokenIndex + 1) & 3;
        token = this.tokens[this.tokenIndex];
        if (!token) {
            this.tokens[this.tokenIndex] = token = {};
        }

        if (!input) {
            token.type = defs.END;
            return token.type;
        }

        if ((match = input.match(fpRegExp))) {
            token.type = defs.NUMBER;
            token.value = parseFloat(match[0]);
        } else if ((match = input.match(/^0[xX][\da-fA-F]+|^0[0-7]*|^\d+/))) {
            token.type = defs.NUMBER;
            token.value = parseInt(match[0]);
        } else if ((match = input.match(/^[$_\w]+/))) {       // FIXME no ES3 unicode
            var id = match[0];
            token.type = getOwnAtomProperty(keywords, id, defs.IDENTIFIER);
            token.value = id;
        } else if ((match = input.match(/^"(?:\\.|[^"])*"|^'(?:\\.|[^'])*'/))) { //"){
            token.type = defs.STRING;
            token.value = eval(match[0]);
        } else if (this.scanOperand && (match = input.match(reRegExp))) {
            token.type = defs.REGEXP;
            token.value = new RegExp(match[1], match[2]);
        } else if ((match = input.match(opRegExp))) {
            var op = match[0],
                nextChar = input.charAt(op.length);
            if (assignOps[op] && (nextChar == '=')) {
                token.type = defs.ASSIGN;
                token.assignOp = defs[opTypeNames[op]];
                match[0] += '=';
            } else {
                token.type = defs[opTypeNames[op]];
                if (this.scanOperand &&
                    (token.type == defs.PLUS || token.type == defs.MINUS)) {
                    token.type += defs.UNARY_PLUS - defs.PLUS;
                }
                token.assignOp = null;
            }
            token.value = op;
        } else if (this.scanNewlines && (match = input.match(/^\n/))) {
            token.type = defs.NEWLINE;
        } else {
            throw this.newSyntaxError("Illegal token");
        }

        token.start = this.cursor;
        this.cursor += match[0].length;
        token.end = this.cursor;
        token.lineno = this.lineno;
        return token.type;
    },

    unget: function () {
        if (++this.lookahead == 4) {
            throw "PANIC: too much lookahead!";
        }
        this.tokenIndex = (this.tokenIndex - 1) & 3;
    },

    newSyntaxError: function (m) {
        var e = new SyntaxError(m, this.filename, this.lineno);
        // This is just the entire file; omit it since it's big
        //e.source = this.source;
        e.cursor = this.cursor;
        return e;
    }

};

function CompilerContext(inFunction) {
    this.inFunction = inFunction;
    this.stmtStack = [];
    this.funDecls = [];
    this.varDecls = [];
}

var CCp = CompilerContext.prototype;
CCp.bracketLevel = CCp.curlyLevel = CCp.parenLevel = CCp.hookLevel = 0;
CCp.ecmaStrictMode = CCp.inForLoopInit = false;

// t, x: Tokenizer, CompilerContext
function Script(t, x) {
    var n = Statements(t, x);
    n.type = defs.SCRIPT;
    n.funDecls = x.funDecls;
    n.varDecls = x.varDecls;
    return n;
}

var top = function (stack) {
    return stack.length && stack[stack.length-1];
};

// t: tokenizer
// type: AST node type
function Node(t, type) {
    var token = t.token();
    if (token) {
        this.type = type || token.type;
        this.value = token.value;
        this.lineno = token.lineno;
        this.start = token.start;
        this.end = token.end;
    } else {
        this.type = type;
        this.lineno = t.lineno;
    }
    this.tokenizer = t;

    this.length = 0;

    for (var i = 2; i < arguments.length; i++) {
        this[this.length++] = arguments[i];
    }
}

// Always use push to add operands to an expression, to update start and end.
Node.prototype.push = function (kid) {
    if (kid.start < this.start) {
        this.start = kid.start;
    }
    if (this.end < kid.end) {
        this.end = kid.end;
    }
    this[this.length++] = kid;
};

Node.prototype.toJSON = function(key) {
  //print('key ' + key);
  //print('toJSON ' + tj++ + ' ' + this.type + ' ' + this.name + ' ' + this.value);
  var jsonObj = {},
      transformed = false;  // whether we fixed up JSON in this Node

  // Variable number of elements: put them under a "children" array
  switch (this.type) {
    case defs.SCRIPT:
    case defs.BLOCK:
    case defs.VAR:
    case defs.OBJECT_INIT:
    case defs.ARRAY_INIT:
    case defs.LIST:  // e.g. argument list
      transformed = true;
      for (var i = 0; i < this.length; i++) {
        if (i === 0) {
          jsonObj.children = [];  // only initialize if we have at least 1
        }
        jsonObj.children.push(this[i]);
      }
      break;
  }

  // Constant number of elements: 0 -> a, 1 -> b, etc.
  if (!transformed) {
    var arity = opArity[this.type];
    // PROPERTY_INIT doesn't have arity since it's not an operator, but it
    // should have 'a' and 'b' rather than 0 and 1
    if ((1 <= arity && arity <= 3) || this.type == defs.PROPERTY_INIT) {
      jsonObj.a = this[0];
      jsonObj.b = this[1];
      jsonObj.c = this[2];  // any of these may be undefined
      transformed = true;
    }
  }

  for (var name in this) {
    if (!this.hasOwnProperty(name)) {
        continue;
    }
    // Nodes are Arrays, but they also have attributes.  I want to iterate over
    // all the attributes, but not get "0", "1", etc., so do this parseInt hack.
    // NaN is not >= 0.
    if (transformed && parseInt(name) >= 0) {
        continue;
    }
    if (name === 'tokenizer')  { // not part of parse tree
        continue;
    }
    // TODO: Make the presence of these attributes configurable, so the size of
    // the JSON isn't too large
    //if (name === 'start' || name === 'end' || name == 'lineno')
    //  continue;  // don't need these most of the time
    if (name === 'length') {
        continue;  // don't need length in JSON
    }
    if (name === 'varDecls' || name === 'funDecls') {
        continue;  // generally redundant with what's already in the tree
    }

    // When printing JSON, the 'target' attr for BREAK or CONTINUE is a code
    // object, which causes an infinite loop
    if (name === 'target') {
        continue;
    }

    if (name === 'type') {
        jsonObj.type = tokens[this.type];
        continue;
    }
    jsonObj[name] = this[name];
  }

  return jsonObj;
};

Node.indentLevel = 0;

function tokenstr(tt) {
    var t = tokens[tt];
    return /^\W/.test(t) ? opTypeNames[t] : t.toUpperCase();
}

var repeat = function (string, n) {
    var s = "", t = string + s;
    while (--n >= 0) {
        s += t;
    }
    return s;
};

Node.prototype.toString = function () {
    var a = [];
    for (var i in this) {
        if (this.hasOwnProperty(i) && i != 'type' && i != 'target') {
            a.push({id: i, value: this[i]});
        }
    }
    a.sort(function (a,b) { return (a.id < b.id) ? -1 : 1; });
    var INDENTATION = "    ";
    var n = ++Node.indentLevel;
    var s = "{\n" + repeat(INDENTATION, n) + "type: " + tokenstr(this.type);
    for (i = 0; i < a.length; i++) {
        s += ",\n" + repeat(INDENTATION, n) + a[i].id + ": " + a[i].value;
    }
    n = --Node.indentLevel;
    s += "\n" + repeat(INDENTATION, n) + "}";
    return s;
};

Node.prototype.getSource = function () {
    return this.tokenizer.source.slice(this.start, this.end);
};

Node.prototype.getFilename = function () {
    return this.tokenizer.filename;
};

// Statement stack and nested statement handler.
function nest(t, x, node, func, end) {
    x.stmtStack.push(node);
    var n = func(t, x);
    x.stmtStack.pop();
    end && t.mustMatch(end);
    return n;
}

// t, x: Tokenizer, CompilerContext
function Statements(t, x) {
    var n = new Node(t, defs.BLOCK);
    x.stmtStack.push(n);
    while (!t.done() && t.peek() != defs.RIGHT_CURLY) {
        n.push(Statement(t, x));
    }
    x.stmtStack.pop();
    return n;
}

// t, x: Tokenizer, CompilerContext
function Block(t, x) {
    t.mustMatch(defs.LEFT_CURLY);
    var n = Statements(t, x);
    t.mustMatch(defs.RIGHT_CURLY);
    return n;
}

var DECLARED_FORM = 0, EXPRESSED_FORM = 1, STATEMENT_FORM = 2;

function Statement(t, x) {
    var i, label, n, n2, ss, tt = t.get();

    // Cases for statements ending in a right curly return early, avoiding the
    // common semicolon insertion magic after this switch.
    switch (tt) {
      case defs.FUNCTION:
        return FunctionDefinition(
            t, x, true,
            (x.stmtStack.length > 1) ? STATEMENT_FORM : DECLARED_FORM);

      case defs.LEFT_CURLY:
        n = Statements(t, x);
        t.mustMatch(defs.RIGHT_CURLY);
        return n;

      case defs.IF:
        n = new Node(t);
        n.condition = ParenExpression(t, x);
        x.stmtStack.push(n);
        n.thenPart = Statement(t, x);
        n.elsePart = t.match(defs.ELSE) ? Statement(t, x) : null;
        x.stmtStack.pop();
        return n;

      case defs.SWITCH:
        n = new Node(t);
        t.mustMatch(defs.LEFT_PAREN);
        n.discriminant = Expression(t, x);
        t.mustMatch(defs.RIGHT_PAREN);
        n.cases = [];
        n.defaultIndex = -1;
        x.stmtStack.push(n);
        t.mustMatch(defs.LEFT_CURLY);
        while ((tt = t.get()) != defs.RIGHT_CURLY) {
            switch (tt) {
              case defs.DEFAULT:
                if (n.defaultIndex >= 0) {
                    throw t.newSyntaxError("More than one switch default");
                }
                // FALL THROUGH
              case defs.CASE:
                n2 = new Node(t);
                if (tt == defs.DEFAULT) {
                    n.defaultIndex = n.cases.length;
                } else {
                    n2.caseLabel = Expression(t, x, defs.COLON);
                }
                break;
              default:
                throw t.newSyntaxError("Invalid switch case");
            }
            t.mustMatch(defs.COLON);
            n2.statements = new Node(t, defs.BLOCK);
            while ((tt=t.peek()) != defs.CASE &&
                   tt != defs.DEFAULT && tt != defs.RIGHT_CURLY) {
                n2.statements.push(Statement(t, x));
            }
            n.cases.push(n2);
        }
        x.stmtStack.pop();
        return n;

      case defs.FOR:
        n = new Node(t);
        n.isLoop = true;
        t.mustMatch(defs.LEFT_PAREN);
        if ((tt = t.peek()) != defs.SEMICOLON) {
            x.inForLoopInit = true;
            if (tt == defs.VAR || tt == defs.CONST) {
                t.get();
                n2 = Variables(t, x);
            } else {
                n2 = Expression(t, x);
            }
            x.inForLoopInit = false;
        }
        if (n2 && t.match(defs.IN)) {
            n.type = defs.FOR_IN;
            if (n2.type == defs.VAR) {
                if (n2.length != 1) {
                    throw new SyntaxError("Invalid for..in left-hand side",
                                          t.getFilename, n2.lineno);
                }

                // NB: n2[0].type == IDENTIFIER and n2[0].value == n2[0].name.
                n.iterator = n2[0];
                n.varDecl = n2;
            } else {
                n.iterator = n2;
                n.varDecl = null;
            }
            n.object = Expression(t, x);
        } else {
            n.setup = n2 || null;
            t.mustMatch(defs.SEMICOLON);
            n.condition = (t.peek() == defs.SEMICOLON) ? null : Expression(t, x);
            t.mustMatch(defs.SEMICOLON);
            n.update = (t.peek() == defs.RIGHT_PAREN) ? null : Expression(t, x);
        }
        t.mustMatch(defs.RIGHT_PAREN);
        n.body = nest(t, x, n, Statement);
        return n;

      case defs.WHILE:
        n = new Node(t);
        n.isLoop = true;
        n.condition = ParenExpression(t, x);
        n.body = nest(t, x, n, Statement);
        return n;

      case defs.DO:
        n = new Node(t);
        n.isLoop = true;
        n.body = nest(t, x, n, Statement, defs.WHILE);
        n.condition = ParenExpression(t, x);
        if (!x.ecmaStrictMode) {
            // <script language="JavaScript"> (without version hints) may need
            // automatic semicolon insertion without a newline after do-while.
            // See http://bugzilla.mozilla.org/show_bug.cgi?id=238945.
            t.match(defs.SEMICOLON);
            return n;
        }
        break;

      case defs.BREAK:
      case defs.CONTINUE:
        n = new Node(t);
        if (t.peekOnSameLine() == defs.IDENTIFIER) {
            t.get();
            n.label = t.token().value;
        }
        ss = x.stmtStack;
        i = ss.length;
        label = n.label;
        if (label) {
            do {
                if (--i < 0) {
                    throw t.newSyntaxError("Label not found");
                }
            } while (ss[i].label != label);
        } else {
            do {
                if (--i < 0) {
                    throw t.newSyntaxError("Invalid " + (
                          (tt == defs.BREAK) ? "break" : "continue"));
                }
            } while (!ss[i].isLoop && (tt != defs.BREAK || ss[i].type != defs.SWITCH));
        }
        n.target = ss[i];
        break;

      case defs.TRY:
        n = new Node(t);
        n.tryBlock = Block(t, x);
        n.catchClauses = [];
        while (t.match(defs.CATCH)) {
            n2 = new Node(t);
            t.mustMatch(defs.LEFT_PAREN);
            n2.varName = t.mustMatch(defs.IDENTIFIER).value;
            if (t.match(defs.IF)) {
                if (x.ecmaStrictMode) {
                    throw t.newSyntaxError("Illegal catch guard");
                }
                if (n.catchClauses.length && !top(n.catchClauses).guard) {
                    throw t.newSyntaxError("Guarded catch after unguarded");
                }
                n2.guard = Expression(t, x);
            } else {
                n2.guard = null;
            }
            t.mustMatch(defs.RIGHT_PAREN);
            n2.block = Block(t, x);
            n.catchClauses.push(n2);
        }
        if (t.match(defs.FINALLY)) {
            n.finallyBlock = Block(t, x);
        }
        if (!n.catchClauses.length && !n.finallyBlock) {
            throw t.newSyntaxError("Invalid try statement");
        }
        return n;

      case defs.CATCH:
      case defs.FINALLY:
        throw t.newSyntaxError(tokens[tt] + " without preceding try");

      case defs.THROW:
        n = new Node(t);
        n.exception = Expression(t, x);
        break;

      case defs.RETURN:
        if (!x.inFunction) {
            throw t.newSyntaxError("Invalid return");
        }
        n = new Node(t);
        tt = t.peekOnSameLine();
        if (tt != defs.END &&
            tt != defs.NEWLINE &&
            tt != defs.SEMICOLON &&
            tt != defs.RIGHT_CURLY)
        {
            n.value = Expression(t, x);
        }
        break;

      case defs.WITH:
        n = new Node(t);
        n.object = ParenExpression(t, x);
        n.body = nest(t, x, n, Statement);
        return n;

      case defs.VAR:
      case defs.CONST:
        n = Variables(t, x);
        break;

      case defs.DEBUGGER:
        n = new Node(t);
        break;

      case defs.NEWLINE:
      case defs.SEMICOLON:
        n = new Node(t, defs.SEMICOLON);
        n.expression = null;
        return n;

      default:
        if (tt == defs.IDENTIFIER) {
            t.scanOperand = false;
            tt = t.peek();
            t.scanOperand = true;
            if (tt == defs.COLON) {
                label = t.token().value;
                ss = x.stmtStack;
                for (i = ss.length-1; i >= 0; --i) {
                    if (ss[i].label == label)
                        throw t.newSyntaxError("Duplicate label");
                }
                t.get();
                n = new Node(t, defs.LABEL);
                n.label = label;
                n.statement = nest(t, x, n, Statement);
                return n;
            }
        }

        n = new Node(t, defs.SEMICOLON);
        t.unget();
        n.expression = Expression(t, x);
        n.end = n.expression.end;
        break;
    }

    if (t.lineno == t.token().lineno) {
        tt = t.peekOnSameLine();
        if (tt != defs.END &&
            tt != defs.NEWLINE &&
            tt != defs.SEMICOLON &&
            tt != defs.RIGHT_CURLY)
        {
            throw t.newSyntaxError("Missing ; before statement");
        }
    }
    t.match(defs.SEMICOLON);
    return n;
}

function FunctionDefinition(t, x, requireName, functionForm) {
    var f = new Node(t);
    if (f.type != defs.FUNCTION) {
        f.type = (f.value == "get") ? defs.GETTER : defs.SETTER;
    }
    if (t.match(defs.IDENTIFIER)) {
        f.name = t.token().value;
    } else if (requireName) {
        throw t.newSyntaxError("Missing function identifier");
    }

    t.mustMatch(defs.LEFT_PAREN);
    f.params = [];
    var tt;
    while ((tt = t.get()) != defs.RIGHT_PAREN) {
        if (tt != defs.IDENTIFIER) {
            throw t.newSyntaxError("Missing formal parameter");
        }
        f.params.push(t.token().value);
        if (t.peek() != defs.RIGHT_PAREN)
            t.mustMatch(defs.COMMA);
    }

    t.mustMatch(defs.LEFT_CURLY);
    var x2 = new CompilerContext(true);
    f.body = Script(t, x2);
    t.mustMatch(defs.RIGHT_CURLY);
    f.end = t.token().end;

    f.functionForm = functionForm;
    if (functionForm == defs.DECLARED_FORM) {
        x.funDecls.push(f);
    }
    return f;
}

function Variables(t, x) {
    var n = new Node(t);
    do {
        t.mustMatch(defs.IDENTIFIER);
        var n2 = new Node(t);
        n2.name = n2.value;
        if (t.match(defs.ASSIGN)) {
            if (t.token().assignOp) {
                throw t.newSyntaxError("Invalid variable initialization");
            }
            n2.initializer = Expression(t, x, defs.COMMA);
        }
        n2.readOnly = (n.type == defs.CONST);
        n.push(n2);
        x.varDecls.push(n2);
    } while (t.match(defs.COMMA));
    return n;
}

function ParenExpression(t, x) {
    t.mustMatch(defs.LEFT_PAREN);
    var n = Expression(t, x);
    t.mustMatch(defs.RIGHT_PAREN);
    return n;
}

var opPrecedence = {
    SEMICOLON: 0,
    COMMA: 1,
    ASSIGN: 2, HOOK: 2, COLON: 2,
    // The above all have to have the same precedence, see bug 330975.
    OR: 4,
    AND: 5,
    BITWISE_OR: 6,
    BITWISE_XOR: 7,
    BITWISE_AND: 8,
    EQ: 9, NE: 9, STRICT_EQ: 9, STRICT_NE: 9,
    LT: 10, LE: 10, GE: 10, GT: 10, IN: 10, INSTANCEOF: 10,
    LSH: 11, RSH: 11, URSH: 11,
    PLUS: 12, MINUS: 12,
    MUL: 13, DIV: 13, MOD: 13,
    DELETE: 14, VOID: 14, TYPEOF: 14, // PRE_INCREMENT: 14, PRE_DECREMENT: 14,
    NOT: 14, BITWISE_NOT: 14, UNARY_PLUS: 14, UNARY_MINUS: 14,
    INCREMENT: 15, DECREMENT: 15,     // postfix
    NEW: 16,
    DOT: 17
};

// Map operator type code to precedence.  Done in 2 steps so we don't modify a
// hash while iterating over it.
var tmpPrecedence = {};
for (var name in opPrecedence) {
    var i = defs[name];
    if (i === undefined) {
        throw {name: 'BadKey', message: name};
    }
    tmpPrecedence[i] = opPrecedence[name];
}
for (var i in tmpPrecedence) {
  opPrecedence[i] = tmpPrecedence[i];
}

var opArity = {
    COMMA: -2,
    ASSIGN: 2,
    HOOK: 3,
    OR: 2,
    AND: 2,
    BITWISE_OR: 2,
    BITWISE_XOR: 2,
    BITWISE_AND: 2,
    EQ: 2, NE: 2, STRICT_EQ: 2, STRICT_NE: 2,
    LT: 2, LE: 2, GE: 2, GT: 2, IN: 2, INSTANCEOF: 2,
    LSH: 2, RSH: 2, URSH: 2,
    PLUS: 2, MINUS: 2,
    MUL: 2, DIV: 2, MOD: 2,
    DELETE: 1, VOID: 1, TYPEOF: 1,  // PRE_INCREMENT: 1, PRE_DECREMENT: 1,
    NOT: 1, BITWISE_NOT: 1, UNARY_PLUS: 1, UNARY_MINUS: 1,
    INCREMENT: 1, DECREMENT: 1,     // postfix
    NEW: 1, NEW_WITH_ARGS: 2, DOT: 2, INDEX: 2, CALL: 2,
    ARRAY_INIT: 1, OBJECT_INIT: 1, GROUP: 1
};

// Map operator type code to arity.  Done in 2 steps so we don't modify a hash
// while iterating over it.
var tmpArity = {};
for (var name in opArity) {
    var i = defs[name];
    if (i === undefined) {
        throw {name: 'BadKey', message: name};
    }
    tmpArity[i] = opArity[name];
}
for (var i in tmpArity) {
  opArity[i] = tmpArity[i];
}


function Expression(t, x, stop) {
    var n, id, tt, operators = [], operands = [];
    var bl = x.bracketLevel, cl = x.curlyLevel, pl = x.parenLevel,
        hl = x.hookLevel;

    function reduce() {
        var n = operators.pop();
        var op = n.type;
        var arity = opArity[op];
        if (arity == -2) {
            // Flatten left-associative trees.
            var left = operands.length >= 2 && operands[operands.length-2];
            if (left.type == op) {
                var right = operands.pop();
                left.push(right);
                return left;
            }
            arity = 2;
        }

        // Always use push to add operands to n, to update start and end.
        var a = operands.splice(operands.length - arity, arity);
        for (var i = 0; i < arity; i++) {
            n.push(a[i]);
        }

        // Include closing bracket or postfix operator in [start,end).
        if (n.end < t.token().end) {
            n.end = t.token().end;
        }

        operands.push(n);
        return n;
    }

loop:
    while ((tt = t.get()) != defs.END) {
        if (tt == stop &&
            x.bracketLevel == bl && x.curlyLevel == cl && x.parenLevel == pl &&
            x.hookLevel == hl) {
            // Stop only if tt matches the optional stop parameter, and that
            // token is not quoted by some kind of bracket.
            break;
        }
        switch (tt) {
          case defs.SEMICOLON:
            // NB: cannot be empty, Statement handled that.
            break loop;

          case defs.ASSIGN:
          case defs.HOOK:
          case defs.COLON:
            if (t.scanOperand) {
                break loop;
            }
            // Use >, not >=, for right-associative ASSIGN and HOOK/COLON.
            while (opPrecedence[top(operators).type] > opPrecedence[tt] ||
                   (tt == defs.COLON && top(operators).type == defs.ASSIGN)) {
                reduce();
            }
            if (tt == defs.COLON) {
                n = top(operators);
                if (n.type != defs.HOOK) {
                    throw t.newSyntaxError("Invalid label");
                }
                --x.hookLevel;
            } else {
                operators.push(new Node(t));
                if (tt == defs.ASSIGN) {
                    top(operands).assignOp = t.token().assignOp;
                } else {
                    ++x.hookLevel;      // tt == HOOK
                }
            }
            t.scanOperand = true;
            break;

          case defs.IN:
            // An in operator should not be parsed if we're parsing the head of
            // a for (...) loop, unless it is in the then part of a conditional
            // expression, or parenthesized somehow.
            if (x.inForLoopInit && !x.hookLevel &&
                !x.bracketLevel && !x.curlyLevel && !x.parenLevel) {
                break loop;
            }
            // FALL THROUGH
          case defs.COMMA:
            // Treat comma as left-associative so reduce can fold left-heavy
            // COMMA trees into a single array.
            // FALL THROUGH
          case defs.OR:
          case defs.AND:
          case defs.BITWISE_OR:
          case defs.BITWISE_XOR:
          case defs.BITWISE_AND:
          case defs.EQ: case defs.NE: case defs.STRICT_EQ: case defs.STRICT_NE:
          case defs.LT: case defs.LE: case defs.GE: case defs.GT:
          case defs.INSTANCEOF:
          case defs.LSH: case defs.RSH: case defs.URSH:
          case defs.PLUS: case defs.MINUS:
          case defs.MUL: case defs.DIV: case defs.MOD:
          case defs.DOT:
            if (t.scanOperand) {
                break loop;
            }
            while (opPrecedence[top(operators).type] >= opPrecedence[tt]) {
                reduce();
            }
            if (tt == defs.DOT) {
                t.mustMatch(defs.IDENTIFIER);
                operands.push(new Node(t, defs.DOT, operands.pop(), new Node(t)));
            } else {
                operators.push(new Node(t));
                t.scanOperand = true;
            }
            break;

          case defs.DELETE:
          case defs.VOID:
          case defs.TYPEOF:
          case defs.NOT:
          case defs.BITWISE_NOT:
          case defs.UNARY_PLUS:
          case defs.UNARY_MINUS:
          case defs.NEW:
            if (!t.scanOperand) {
                break loop;
            }
            operators.push(new Node(t));
            break;

          case defs.INCREMENT:
          case defs.DECREMENT:
            if (t.scanOperand) {
                operators.push(new Node(t));  // prefix increment or decrement
            } else {
                // Don't cross a line boundary for postfix {in,de}crement.
                if (t.tokens[(t.tokenIndex + t.lookahead - 1) & 3].lineno !=
                    t.lineno) {
                    break loop;
                }

                // Use >, not >=, so postfix has higher precedence than prefix.
                while (opPrecedence[top(operators).type] > opPrecedence[tt])
                    reduce();
                n = new Node(t, tt, operands.pop());
                n.postfix = true;
                operands.push(n);
            }
            break;

          case defs.FUNCTION:
            if (!t.scanOperand) {
                break loop;
            }
            operands.push(FunctionDefinition(t, x, false, defs.EXPRESSED_FORM));
            t.scanOperand = false;
            break;

          case defs.NULL:
          case defs.THIS:
          case defs.TRUE:
          case defs.FALSE:
          case defs.IDENTIFIER:
          case defs.NUMBER:
          case defs.STRING:
          case defs.REGEXP:
            if (!t.scanOperand) {
                break loop;
            }
            operands.push(new Node(t));
            t.scanOperand = false;
            break;

          case defs.LEFT_BRACKET:
            if (t.scanOperand) {
                // Array initialiser.  Parse using recursive descent, as the
                // sub-grammar here is not an operator grammar.
                n = new Node(t, defs.ARRAY_INIT);
                while ((tt = t.peek()) != defs.RIGHT_BRACKET) {
                    if (tt == defs.COMMA) {
                        t.get();
                        n.push(null);
                        continue;
                    }
                    n.push(Expression(t, x, defs.COMMA));
                    if (!t.match(defs.COMMA))
                        break;
                }
                t.mustMatch(defs.RIGHT_BRACKET);
                operands.push(n);
                t.scanOperand = false;
            } else {
                // Property indexing operator.
                operators.push(new Node(t, defs.INDEX));
                t.scanOperand = true;
                ++x.bracketLevel;
            }
            break;

          case defs.RIGHT_BRACKET:
            if (t.scanOperand || x.bracketLevel == bl)
                break loop;
            while (reduce().type != defs.INDEX)
                continue;
            --x.bracketLevel;
            break;

          case defs.LEFT_CURLY:
            if (!t.scanOperand)
                break loop;
            // Object initialiser.  As for array initialisers (see above),
            // parse using recursive descent.
            ++x.curlyLevel;
            n = new Node(t, defs.OBJECT_INIT);
          object_init:
            if (!t.match(defs.RIGHT_CURLY)) {
                do {
                    tt = t.get();
                    if ((t.token().value == "get" || t.token().value == "set") &&
                        t.peek() == defs.IDENTIFIER) {
                        if (x.ecmaStrictMode)
                            throw t.newSyntaxError("Illegal property accessor");
                        n.push(FunctionDefinition(t, x, true, defs.EXPRESSED_FORM));
                    } else {
                        switch (tt) {
                          case defs.IDENTIFIER:
                          case defs.NUMBER:
                          case defs.STRING:
                            id = new Node(t);
                            break;
                          case defs.RIGHT_CURLY:
                            if (x.ecmaStrictMode)
                                throw t.newSyntaxError("Illegal trailing ,");
                            break object_init;
                          default:
                            throw t.newSyntaxError("Invalid property name");
                        }
                        t.mustMatch(defs.COLON);
                        n.push(new Node(t, defs.PROPERTY_INIT, id,
                                        Expression(t, x, defs.COMMA)));
                    }
                } while (t.match(defs.COMMA));
                t.mustMatch(defs.RIGHT_CURLY);
            }
            operands.push(n);
            t.scanOperand = false;
            --x.curlyLevel;
            break;

          case defs.RIGHT_CURLY:
            if (!t.scanOperand && x.curlyLevel != cl)
                throw "PANIC: right curly botch";
            break loop;

          case defs.LEFT_PAREN:
            if (t.scanOperand) {
                operators.push(new Node(t, defs.GROUP));
            } else {
                while (opPrecedence[top(operators).type] > opPrecedence[defs.NEW])
                    reduce();

                // Handle () now, to regularize the n-ary case for n > 0.
                // We must set scanOperand in case there are arguments and
                // the first one is a regexp or unary+/-.
                n = top(operators);
                t.scanOperand = true;
                if (t.match(defs.RIGHT_PAREN)) {
                    if (n.type == defs.NEW) {
                        --operators.length;
                        n.push(operands.pop());
                    } else {
                        n = new Node(t, defs.CALL, operands.pop(),
                                     new Node(t, defs.LIST));
                    }
                    operands.push(n);
                    t.scanOperand = false;
                    break;
                }
                if (n.type == defs.NEW)
                    n.type = defs.NEW_WITH_ARGS;
                else
                    operators.push(new Node(t, defs.CALL));
            }
            ++x.parenLevel;
            break;

          case defs.RIGHT_PAREN:
            if (t.scanOperand || x.parenLevel == pl)
                break loop;
            while ((tt = reduce().type) != defs.GROUP && tt != defs.CALL &&
                   tt != defs.NEW_WITH_ARGS) {
                continue;
            }
            if (tt != defs.GROUP) {
                n = top(operands);
                if (n[1].type != defs.COMMA)
                    n[1] = new Node(t, defs.LIST, n[1]);
                else
                    n[1].type = defs.LIST;
            }
            --x.parenLevel;
            break;

          // Automatic semicolon insertion means we may scan across a newline
          // and into the beginning of another statement.  If so, break out of
          // the while loop and let the t.scanOperand logic handle errors.
          default:
            break loop;
        }
    }

    if (x.hookLevel != hl)
        throw t.newSyntaxError("Missing : after ?");
    if (x.parenLevel != pl)
        throw t.newSyntaxError("Missing ) in parenthetical");
    if (x.bracketLevel != bl)
        throw t.newSyntaxError("Missing ] in index expression");
    if (t.scanOperand)
        throw t.newSyntaxError("Missing operand");

    // Resume default mode, scanning for operands, not operators.
    t.scanOperand = true;
    t.unget();
    while (operators.length)
        reduce();
    return operands.pop();
}

// Args:
//   s: string to parse
//   f: filename, defaults to ""
//   l: line number, defaults to 1
var parse = exports.parse = function (s, f, l) {
    var t = new Tokenizer(s, f, l);
    var x = new CompilerContext(false);
    var n = Script(t, x);
    if (!t.done()) {
        throw t.newSyntaxError("Syntax error");
    }
    return n;
};
