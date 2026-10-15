"""Read official .kbf backups using the same mappings as Android KbfReader."""
import io
import sqlite3
import tempfile
import zipfile
from pathlib import Path


def base36(number):
    chars, result = '0123456789abcdefghijklmnopqrstuvwxyz', ''
    while number:
        number, digit = divmod(number, 36)
        result = chars[digit] + result
    return result or '0'


def read_kbf(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        file = next((f for f in archive.infolist() if f.filename.lower().endswith('.sqlite')), None)
        if file is None or file.file_size > 512 * 1024 * 1024:
            raise ValueError('不是有效的随手记备份，或数据库过大')
        data = archive.read(file)
    with tempfile.TemporaryDirectory(prefix='xunji-kbf-') as directory:
        path = Path(directory) / 'mymoney.sqlite'
        path.write_bytes(b'SQLite format 3\0' + data[16:])
        db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
        try:
            return _parse(db)
        finally:
            db.close()


def _parse(db):
    groups = {int(row[0]): row[1:] for row in db.execute('SELECT accountGroupPOID,name,type,parentAccountGroupPOID FROM t_account_group')}
    trim = lambda value: str(value or '').strip()
    sid = lambda value: str(int(value)) if value else ''
    accounts = []
    for aid, name, group, memo, hidden, currency in db.execute('SELECT accountPOID,name,accountGroupPOID,memo,hidden,currencyType FROM t_account ORDER BY ordered'):
        g = groups.get(group, ('', 0, 0))
        parent = groups.get(int(g[2] or 0), ('', 0, 0))
        accounts.append({'id': sid(aid), 'name': trim(name), 'group': trim(g[0]), 'pgroup': trim(parent[0]),
                         'gtype': int(g[1] or 0), 'memo': trim(memo), 'hidden': hidden == 1, 'cur': trim(currency)})
    cats = [{'id': sid(cid), 'name': trim(name), 'pid': sid(parent) if depth == 2 else '', 'type': 'income' if kind == 1 else 'expense'}
            for cid, name, parent, kind, depth in db.execute('SELECT categoryPOID,name,parentCategoryPOID,type,depth FROM t_category WHERE depth IN (1,2) AND type IN (0,1) ORDER BY depth,ordered')]
    cat_ids = {c['id'] for c in cats}
    tags = dict(db.execute('SELECT tagPOID,name FROM t_tag'))
    members, projects = {}, {}
    for tid, tag, kind in db.execute('SELECT transactionPOID,projectCategoryPOID,type FROM t_transaction_projectcategory_map'):
        name = trim(tags.get(tag))
        if name:
            target = members if kind == 2 else projects
            target[tid] = target[tid] + '、' + name if tid in target else name
    entities = dict(db.execute('SELECT tradingEntityPOID,name FROM t_tradingEntity'))
    txns, seen, skipped = [], set(), 0
    for tid, created, timestamp, memo, kind, ba, bc, bm, sa, sc, sm, entity, relation in db.execute(
        'SELECT transactionPOID,createdTime,tradeTime,memo,type,buyerAccountPOID,buyerCategoryPOID,buyerMoney,'
        'sellerAccountPOID,sellerCategoryPOID,sellerMoney,relationUnitPOID,relation FROM t_transaction ORDER BY tradeTime'):
        to, cat = '', ''
        if kind == 0:
            typ, account, cat, amount = 'expense', sid(ba), sid(sc), bm
        elif kind == 1:
            typ, account, cat, amount = 'income', sid(sa), sid(bc), sm
        elif kind in (2, 3):
            if relation and relation in seen:
                continue
            if relation:
                seen.add(relation)
            typ, account, to, amount = 'transfer', sid(ba), sid(sa), bm
        elif kind == 8:
            typ, account, amount = 'adjust', sid(sa), sm
        else:
            skipped += 1
            continue
        if cat not in cat_ids:
            cat = ''
        txns.append([typ, timestamp, amount or 0, account, to, cat, trim(memo), trim(entities.get(entity)),
                     members.get(tid, ''), projects.get(tid, ''), f'{tid}-{base36(int(created or 0))}'])
    return {'ok': True, 'accounts': accounts, 'cats': cats, 'txns': txns, 'skipped': skipped,
            'from': min((t[1] for t in txns), default=0), 'to': max((t[1] for t in txns), default=0)}
