import base64
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storage import SecureStore, dumps, atomic_write
from native import NativeBridge
from app import create_server
from kbf import read_kbf

DATA = dumps({'v': 2, 'txns': [], '备注': '中文账本 😀'})


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.store = SecureStore(self.home / 'a')
        self.store.open()

    def tearDown(self):
        self.tmp.cleanup()

    def staged(self, store, result):
        return ''.join(store.chunk(i) for i in range(result['chunks']))

    def test_encryption_dpapi_and_restart(self):
        self.store.save(DATA)
        raw = self.store.path.read_bytes()
        self.assertNotIn('中文'.encode(), raw)
        self.assertNotIn(base64.b64encode(self.store.dek), self.store.prefs_path.read_bytes())
        reopened = SecureStore(self.store.home)
        self.assertEqual(self.staged(reopened, reopened.open()), DATA)

    def test_password_and_cross_device_backup(self):
        self.store.set_password('', 'sample-pass', DATA)
        self.assertTrue(self.store.check_password('sample-pass'))
        self.assertFalse(self.store.check_password('wrong'))
        foreign = SecureStore(self.home / 'b')
        foreign.open()
        text = self.store.path.read_text('utf-8')
        self.assertEqual(foreign.decrypt_backup(text, '')['need'], 'password')
        with self.assertRaises(ValueError):
            foreign.decrypt_backup(text, 'wrong')
        self.assertEqual(self.staged(foreign, foreign.decrypt_backup(text, 'sample-pass')), DATA)
        foreign.save('{"other":true}')
        foreign.path.write_text(text, encoding='utf-8')
        self.assertEqual(foreign.open()['need'], 'password')
        self.assertEqual(self.staged(foreign, foreign.unlock('sample-pass')), DATA)
        fresh = SecureStore(foreign.home)
        self.assertEqual(self.staged(fresh, fresh.open()), DATA)

    def test_wrong_old_password_and_failed_write_preserve_kdf(self):
        self.store.set_password('', 'sample-pass', DATA)
        with self.assertRaises(ValueError):
            self.store.set_password('wrong', 'another-pass', DATA)
        old = self.store.kdf
        original = self.store.save
        self.store.save = lambda _: (_ for _ in ()).throw(OSError('disk full'))
        with self.assertRaises(OSError):
            self.store.set_password('sample-pass', 'another-pass', DATA)
        self.assertEqual(self.store.kdf, old)
        self.store.save = original
        self.assertTrue(self.store.check_password('sample-pass'))

    def test_backups_rotation_and_restore(self):
        names = []
        for i in range(7):
            self.store.save(dumps({'v': 2, 'txns': [], 'test': i}))
            names.append(self.store.backup(force=True)['name'])
        listed = self.store.list_backups()['items']
        self.assertEqual(len(listed), 5)
        restored = json.loads(self.staged(self.store, self.store.restore(names[-2])))
        self.assertEqual(restored['test'], 5)
        with self.assertRaises(ValueError):
            self.store.restore('../xunji.db')

    def test_directory_move_open_and_default(self):
        self.store.save(DATA)
        target = self.home / 'chosen'
        self.assertFalse(self.store.select_directory(target)['exists'])
        self.store.use_directory('write', DATA)
        self.assertEqual(self.store.path.parent, target)
        self.assertEqual(self.staged(self.store, self.store.open()), DATA)
        self.store.use_default(DATA)
        self.assertEqual(self.store.path.parent, self.store.home)
        self.assertTrue((target / 'xunji.db').is_file())

    def test_background_save_completion_error_and_recovery(self):
        bridge = NativeBridge(self.home / 'worker')
        bridge.dbOpen()
        gate, entered = threading.Event(), threading.Event()
        actual = bridge.store.save_parts
        def slow(meta, parts):
            entered.set()
            gate.wait(3)
            actual(meta, parts)
        bridge.store.save_parts = slow
        self.assertEqual(bridge.dbCommit('{"v":2}', '2026'), 'missing')
        bridge.dbPart('2026', '{"id":[]}')
        self.assertEqual(bridge.dbCommit('{"v":2}', '2026'), '')
        self.assertTrue(entered.wait(2))
        self.assertTrue(bridge.dbSaveStatus()['saving'])
        bridge.dbPart('2026', '{"id":["new"]}')
        bridge.dbCommit('{"v":2}', '2026')
        gate.set()
        bridge.dbWait()
        self.assertFalse(bridge.dbSaveStatus()['saving'])
        self.assertEqual(bridge.dbSaveStatus()['error'], '')
        result = json.loads(self.staged(bridge.store, bridge.store.open()))
        self.assertEqual(result['txns'][0]['id'], ['new'])
        bridge.store.save_parts = lambda *_: (_ for _ in ()).throw(OSError('disk full'))
        bridge.dbCommit('{"v":2}', '2026'); bridge.dbWait()
        self.assertEqual(bridge.dbSaveStatus()['error'], 'disk full')
        bridge.store.save_parts = actual
        bridge.dbCommit('{"v":2}', '2026'); bridge.dbWait()
        self.assertEqual(bridge.dbSaveStatus()['error'], '')
        bridge.workers.shutdown(wait=True)
        bridge.ocr_worker.shutdown(wait=True)

    def test_http_origin_token_and_path_access(self):
        bridge = NativeBridge(self.home / 'server')
        server = create_server(bridge)
        base = 'http://' + server.host
        try:
            html = urllib.request.urlopen(base).read().decode()
            self.assertIn('/desktop/ui.js', html)
            self.assertIn(server.session_token, html)
            def post(headers):
                body = dumps({'method': 'dbInfo', 'args': []}).encode()
                return urllib.request.urlopen(urllib.request.Request(base + '/api', body, headers=headers))
            with self.assertRaises(urllib.error.HTTPError):
                post({'Content-Type': 'application/json'})
            with self.assertRaises(urllib.error.HTTPError):
                post({'X-Xunji-Token': server.session_token, 'Origin': 'https://attacker.invalid'})
            self.assertIn('defaultPath', post({'X-Xunji-Token': server.session_token}).read().decode())
            for route in ['/desktop/storage.py', '/%2e%2e/desktop/storage.py']:
                with self.assertRaises(urllib.error.HTTPError):
                    urllib.request.urlopen(base + route)
        finally:
            server.shutdown(); server.server_close()

    def test_kbf_mobile_mappings_and_transfer_dedup(self):
        path = self.home / 'fixture.sqlite'
        db = sqlite3.connect(path)
        db.executescript('''
          CREATE TABLE t_account_group(accountGroupPOID,name,type,parentAccountGroupPOID);
          INSERT INTO t_account_group VALUES(1,'现金',0,0);
          CREATE TABLE t_account(accountPOID,name,accountGroupPOID,memo,hidden,currencyType,ordered);
          INSERT INTO t_account VALUES(1,'现金',1,'',0,'CNY',0),(2,'银行卡',1,'',0,'CNY',1);
          CREATE TABLE t_category(categoryPOID,name,parentCategoryPOID,type,depth,ordered);
          INSERT INTO t_category VALUES(10,'餐饮',0,0,1,0),(11,'午饭',10,0,2,1);
          CREATE TABLE t_tag(tagPOID,name); INSERT INTO t_tag VALUES(5,'本人'),(6,'旅行');
          CREATE TABLE t_transaction_projectcategory_map(transactionPOID,projectCategoryPOID,type);
          INSERT INTO t_transaction_projectcategory_map VALUES(1,5,2),(1,6,1);
          CREATE TABLE t_tradingEntity(tradingEntityPOID,name); INSERT INTO t_tradingEntity VALUES(3,'餐厅');
          CREATE TABLE t_transaction(transactionPOID,createdTime,tradeTime,memo,type,buyerAccountPOID,buyerCategoryPOID,buyerMoney,sellerAccountPOID,sellerCategoryPOID,sellerMoney,relationUnitPOID,relation);
          INSERT INTO t_transaction VALUES(1,123,1000,'午餐',0,1,0,15,0,11,15,3,''),(2,124,2000,'转账',2,1,0,20,2,0,20,0,'same'),(3,125,2000,'转账',3,1,0,20,2,0,20,0,'same'),(4,126,3000,'盘点',8,0,0,0,1,0,-2,0,'');
        ''')
        db.close()
        raw = b'\0' * 16 + path.read_bytes()[16:]
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('mymoney.sqlite', raw)
        result = read_kbf(archive.getvalue())
        self.assertEqual(len(result['txns']), 3)
        self.assertEqual(result['txns'][0], ['expense', 1000, 15, '1', '', '11', '午餐', '餐厅', '本人', '旅行', '1-3f'])
        self.assertEqual(result['txns'][1][0:6], ['transfer', 2000, 20, '1', '2', ''])
        self.assertEqual(result['txns'][2][0:4], ['adjust', 3000, -2, '1'])

    def test_native_export_dialog_result_and_cancel(self):
        bridge = NativeBridge(self.home / 'export')
        bridge.dbOpen()
        bridge.store.save(DATA)
        chosen = self.home / '测试导出.csv'
        class DialogWindow:
            def create_file_dialog(self, kind, **options):
                return (str(chosen),)
        bridge.window = DialogWindow()
        self.assertIn(str(chosen), bridge.saveFile('report.csv', '\ufeff日期,金额\r\n2026-10-15,42.50'))
        self.assertTrue(chosen.read_bytes().startswith(b'\xef\xbb\xbf'))
        bridge.dbSetPassword('', 'export-test-password', DATA)
        bridge.exportBackup('backup.db', DATA)
        exported = chosen.read_text('utf-8')
        foreign = SecureStore(self.home / 'export-other')
        foreign.open()
        self.assertEqual(self.staged(foreign, foreign.decrypt_backup(exported, 'export-test-password')), DATA)
        bridge.window.create_file_dialog = lambda *args, **kwargs: None
        before = chosen.read_bytes()
        self.assertEqual(bridge.saveFile('cancel.csv', 'ignored'), '已取消导出')
        self.assertEqual(chosen.read_bytes(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
