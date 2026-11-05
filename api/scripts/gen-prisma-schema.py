"""Genera prisma/schema.prisma a partir de information_schema (equivalente a `prisma db pull`).
Uso: python3 scripts/gen-prisma-schema.py <base_de_datos>  (requiere cliente mysql con acceso)."""
import subprocess, sys, re, collections, os, shlex
DB = sys.argv[1] if len(sys.argv) > 1 else 'hotel_dev'
def q(sql):
    out = subprocess.run(shlex.split(os.environ.get('MYSQL_CMD', 'mysql')) + ['--default-character-set=utf8mb4', '-B', '-N', '-e', sql, DB], capture_output=True, text=True, check=True).stdout
    return [l.split('\t') for l in out.splitlines() if l]
tables = [r[0] for r in q(f"select table_name from information_schema.tables where table_schema='{DB}' and table_type='BASE TABLE' and table_name <> '_prisma_migrations' order by table_name")]
cols = collections.defaultdict(list)
for t, c, ct, nul, dflt, extra, key, cmt in q(f"select table_name,column_name,column_type,is_nullable,ifnull(column_default,'<<NULL>>'),extra,column_key,column_comment from information_schema.columns where table_schema='{DB}' order by table_name,ordinal_position"):
    cols[t].append(dict(name=c, type=ct, null=nul == 'YES', default=None if dflt == '<<NULL>>' else dflt, extra=extra, key=key, comment=cmt))
idx = collections.defaultdict(lambda: collections.OrderedDict())
for t, name, col, nonuniq, seq in q(f"select table_name,index_name,column_name,non_unique,seq_in_index from information_schema.statistics where table_schema='{DB}' order by table_name,index_name,seq_in_index"):
    idx[t].setdefault(name, {'cols': [], 'unique': nonuniq == '0'})['cols'].append(col)
fks = collections.defaultdict(list)  # child -> list
for t, cname, col, rt, rc, dr, ur in q(f"select k.table_name,k.constraint_name,k.column_name,k.referenced_table_name,k.referenced_column_name,r.delete_rule,r.update_rule from information_schema.key_column_usage k join information_schema.referential_constraints r on r.constraint_schema=k.constraint_schema and r.constraint_name=k.constraint_name where k.table_schema='{DB}' and k.referenced_table_name is not null order by k.table_name,k.ordinal_position"):
    fks[t].append(dict(name=cname, col=col, rt=rt, rc=rc, dr=dr, ur=ur))
enums = collections.OrderedDict()
RULE = {'CASCADE': 'Cascade', 'RESTRICT': 'Restrict', 'NO ACTION': 'NoAction', 'SET NULL': 'SetNull'}

def scalar(t, c):
    ct = c['type']; m = re.match(r'(\w+)(?:\(([^)]*)\))?\s*(unsigned)?', ct); base, arg, uns = m.group(1), m.group(2), m.group(3)
    if base == 'tinyint' and arg == '1': return 'Boolean', '@db.TinyInt'
    if base == 'enum':
        en = f"{t}_{c['name']}"; enums[en] = re.findall(r"'([^']*)'", ct); return en, ''
    nat = {('tinyint', True): ('Int', '@db.UnsignedTinyInt'), ('tinyint', False): ('Int', '@db.TinyInt'),
           ('smallint', True): ('Int', '@db.UnsignedSmallInt'), ('smallint', False): ('Int', '@db.SmallInt'),
           ('int', True): ('Int', '@db.UnsignedInt'), ('int', False): ('Int', ''),
           ('bigint', True): ('BigInt', '@db.UnsignedBigInt'), ('bigint', False): ('BigInt', '')}
    if (base, bool(uns)) in nat: return nat[(base, bool(uns))]
    if base == 'decimal': return 'Decimal', f'@db.Decimal({arg})'
    if base == 'varchar': return 'String', f'@db.VarChar({arg})'
    if base == 'char': return 'String', f'@db.Char({arg})'
    if base == 'varbinary': return 'Bytes', f'@db.VarBinary({arg})'
    if base == 'date': return 'DateTime', '@db.Date'
    if base == 'datetime': return 'DateTime', '@db.DateTime(0)'
    if base == 'time': return 'DateTime', '@db.Time(0)'
    if base == 'timestamp': return 'DateTime', '@db.Timestamp(0)'
    if base == 'json': return 'Json', ''
    raise ValueError(ct)

def default(ptype, c):
    d = c['default']
    if 'auto_increment' in c['extra']: return '@default(autoincrement())'
    if d is None or ('STORED GENERATED' in c['extra'].upper() or 'VIRTUAL GENERATED' in c['extra'].upper()): return ''
    if d.upper().startswith('CURRENT_TIMESTAMP'): return '@default(now())'
    if ptype == 'Boolean': return '@default(%s)' % ('true' if d == '1' else 'false')
    if ptype in ('Int', 'BigInt', 'Decimal'): return f'@default({d})'
    if ptype == 'String': return '@default("%s")' % d
    if ptype in enums: return f'@default({d})'
    return '@default(dbgenerated("\'%s\'"))' % d

out = ['// Generado desde la base de datos con scripts/gen-prisma-schema.py (equivalente a `prisma db pull`).',
       '// Las reglas que Prisma no modela (CHECK, triggers, procedimientos, vistas, columnas generadas)',
       '// viven en las migraciones SQL de prisma/migrations. No edites el esquema a mano: cambia la BD con una migración',
       '// y vuelve a generar este archivo.', '',
       'generator client {', '  provider        = "prisma-client-js"', '  engineType      = "client"', '}', '',
       'datasource db {', '  provider = "mysql"', '  url      = env("DATABASE_URL")', '}', '']
# back relations
back = collections.defaultdict(list)
pair_count = collections.Counter((t, f['rt']) for t in fks for f in fks[t])
models = []
for t in tables:
    colnames = {c['name'] for c in cols[t]}
    lines = []
    pk = [i for n, i in idx[t].items() if n == 'PRIMARY']
    pkcols = pk[0]['cols'] if pk else []
    single_unique = {i['cols'][0]: n for n, i in idx[t].items() if i['unique'] and n != 'PRIMARY' and len(i['cols']) == 1}
    for c in cols[t]:
        ptype, nat = scalar(t, c)
        attrs = []
        if len(pkcols) == 1 and c['name'] == pkcols[0]: attrs.append('@id')
        dfl = default(ptype, c)
        if dfl: attrs.append(dfl)
        if c['name'] in single_unique: attrs.append(f'@unique(map: "{single_unique[c["name"]]}")')
        if nat: attrs.append(nat)
        gen = ' /// columna generada por la BD (solo lectura)' if ('STORED GENERATED' in c['extra'].upper() or 'VIRTUAL GENERATED' in c['extra'].upper()) else ''
        lines.append(f"  {c['name']} {ptype}{'?' if c['null'] else ''} {' '.join(attrs)}{gen}".rstrip())
    for f in fks[t]:
        base = re.sub(r'_(id|codigo)$', '', f['col'])
        fname = base if base not in colnames and base != t else base + '_ref'
        if fname in colnames: fname = base + '_rel'
        many = pair_count[(t, f['rt'])] > 1 or f['rt'] == t
        rel = f"{t}_{f['col']}" if many else None
        nullable = next(c['null'] for c in cols[t] if c['name'] == f['col'])
        relattr = f'@relation({chr(34)+rel+chr(34)+", " if rel else ""}fields: [{f["col"]}], references: [{f["rc"]}], onDelete: {RULE[f["dr"]]}, onUpdate: {RULE[f["ur"]]}, map: "{f["name"]}")'
        lines.append(f"  {fname} {f['rt']}{'?' if nullable else ''} {relattr}")
        bname = f"{t}_{f['col']}" if many else t
        if f['rt'] == t: bname = f"{t}_{f['col']}_inversa"
        back[f['rt']].append(f"  {bname} {t}[]{' @relation(' + chr(34) + rel + chr(34) + ')' if rel else ''}")
    blocks = []
    if len(pkcols) > 1: blocks.append(f"  @@id([{', '.join(pkcols)}])")
    for n, i in idx[t].items():
        if n == 'PRIMARY' or (i['unique'] and len(i['cols']) == 1): continue
        kind = '@@unique' if i['unique'] else '@@index'
        blocks.append(f"  {kind}([{', '.join(i['cols'])}], map: \"{n}\")")
    models.append((t, lines, blocks))
for t, lines, blocks in models:
    out.append(f'model {t} {{'); out += lines + back[t]
    if blocks: out.append(''); out += blocks
    out += ['}', '']
for en, vals in enums.items():
    out.append(f'enum {en} {{'); out += [f'  {v}' for v in vals]; out += ['}', '']
open('prisma/schema.prisma', 'w', encoding='utf8').write('\n'.join(out))
print(len(tables), 'modelos,', len(enums), 'enums')
