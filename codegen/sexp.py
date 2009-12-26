#!/usr/bin/python -S
"""
sexp.py
"""

__author__ = 'Andy Chu'


import os
import sys

this_dir = os.path.dirname(sys.argv[0])

# HACK
sys.path.append('/home/andy/hg/json-template/python')
  #os.path.join(this_dir, '..', 'build')
import jsontemplate

# HACK
sys.path.append('/home/andy/svn/pan/trunk')
from pan.core import json
from pan.core import util

B = util.BlockStr


class Error(Exception):
  pass


class NodePredicates(jsontemplate.FunctionRegistry):
  def Lookup(self, user_str):
    """The node type is also a predicate."""
    def func(v, context, args):
      # jprint v['type'], '==', user_str
      #print v['type']== user_str
      return v['type'] == user_str
    return func, None  # No arguments

node_predicates = NodePredicates()

statement = jsontemplate.Template(
    B("""
    {.if SCRIPT}
      {.repeated section children}
      {@|template SELF}
      {.end}

    {.or BLOCK}
      {.repeated section children}
      {@|template SELF}
      {.end}

    {.or function}
      function {name} ({.repeated section params}{@}{.alternates with}, {.end})
          {.meta-left}{.newline}
        {#body|template SELF}
      }{.newline}

    {.or for}
    for ({setup|template SELF}; {#}
         {condition|template SELF}; {#}
         {update|template SELF}) {.meta-left} {.newline}
      {body|template SELF}
    } {.newline}

    {.or if}
      if ({condition|template SELF}) {.meta-left}{.newline}
        {thenPart|template SELF}{.newline}
      } else {.meta-left}{.newline}
        {elsePart|template SELF}{.newline}
      }{.newline}

    {.or var}
      var {.repeated section children}
            {.section initializer}
              {name} = {@|template SELF}
            {.or}
              {name}
            {.end}
          {.alternates with},
          {.end};

    {.or ;}  {# statement}
      {expression|template SELF};
    {.or CALL}
      {a|template SELF}({b|template SELF})
    {.or LIST}  {# e.g. argument list}
      {.repeated section children}
        {@|template SELF}
      {.alternates with},
      {.end}

    {# ---------------- }
    {# BINARY OPERATORS }
    {# ---------------- }

    {.or <}
      {a|template SELF} < {b|template SELF}
    {.or >}
      {a|template SELF} > {b|template SELF}
    {.or <=}
      {a|template SELF} <= {b|template SELF}
    {.or >=}
      {a|template SELF} >= {b|template SELF}
    {.or +}
      {a|template SELF} + {b|template SELF}
    {.or %}
      {a|template SELF} % {b|template SELF}
    {.or ===}
      {a|template SELF} === {b|template SELF}

    {# --------------- }
    {# UNARY OPERATORS }
    {# --------------- }

    {.or ++}
      {# TODO: fix}
      {.if postfix}
        {a|template SELF}++
      {.or}
        ++{a|template SELF}
      {.end}

    {.or IDENTIFIER}
      {value}
    {.or NUMBER}
      {value}
    {.or STRING}
      "{value}"  {# TODO: Proper quoting}
    {.end}
    """), more_predicates=node_predicates, whitespace='strip-line')


def main(argv):
  """Returns an exit code."""

  filename = os.path.join(this_dir, argv[1])
  parse_tree = json.loads(open(filename).read())
  print statement.expand(parse_tree)
  return 0


if __name__ == '__main__':
  try:
    sys.exit(main(sys.argv))
  except Error, e:
    print >> sys.stderr, e.args[0]
    sys.exit(1)
