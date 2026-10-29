import importlib.util
import io
import tarfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('restore', Path(__file__).with_name('schoolos_v5_isolated_restore_20261029.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class ArchiveSafety(unittest.TestCase):
    def archive(self, names):
        b = io.BytesIO()
        with tarfile.open(fileobj=b, mode='w') as a:
            for name, kind in names:
                m = tarfile.TarInfo(name)
                m.type = kind
                a.addfile(m)
        b.seek(0)
        return tarfile.open(fileobj=b)
    def test_regular(self):
        with self.archive([('./uploads', tarfile.DIRTYPE), ('./uploads/file', tarfile.REGTYPE)]) as a:
            self.assertEqual(len(r.members(a)[0]), 2)
    def test_unsafe(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('hard', tarfile.LNKTYPE), ('fifo', tarfile.FIFOTYPE)]:
            with self.subTest(name=name), self.archive([(name, kind)]) as a:
                with self.assertRaises(RuntimeError): r.members(a)
    def test_duplicate(self):
        with self.archive([('same', tarfile.REGTYPE), ('./same', tarfile.REGTYPE)]) as a:
            with self.assertRaises(RuntimeError): r.members(a)
    def test_hash(self):
        self.assertEqual(r.digest(io.BytesIO(b'test')), r.digest(io.BytesIO(b'test')))
        self.assertNotEqual(r.digest(io.BytesIO(b'test')), r.digest(io.BytesIO(b'fail')))

if __name__ == '__main__': unittest.main()
