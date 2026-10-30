import json
import unittest
import schoolos_v5_monitor as m

class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.ready = {'status':'ready', 'checks':{'database':True, 'redis':True}}
        self.ops = {'status':'operational','workers':{'notificationDelivery':{'healthy':True},'saasLifecycle':{'healthy':True}}}
    def test_healthy(self):
        self.assertTrue(m.acceptable('/',200,1,b''))
        self.assertTrue(m.acceptable(m.PATHS[1],200,1,json.dumps(self.ready)))
        self.assertTrue(m.acceptable(m.PATHS[2],200,1,json.dumps(self.ops)))
    def test_bad_status_and_latency(self):
        for code in (201,301,401,403,500):
            self.assertFalse(m.acceptable('/',code,1,b''))
        self.assertFalse(m.acceptable('/',200,8.01,b''))
    def test_malformed(self):
        for body in ('bad', 'null', '[]', '{}', '{"checks":true}'):
            self.assertFalse(m.acceptable(m.PATHS[1],200,1,body))
    def test_failed_dependency(self):
        for value in (False, 'true', 1, None):
            self.ready['checks']['database'] = value
            self.assertFalse(m.acceptable(m.PATHS[1],200,1,json.dumps(self.ready)))
    def test_worker_failure(self):
        self.ops['workers']['saasLifecycle']['healthy'] = False
        self.assertFalse(m.acceptable(m.PATHS[2],200,1,json.dumps(self.ops)))
    def test_missing_worker(self):
        del self.ops['workers']['notificationDelivery']
        self.assertFalse(m.acceptable(m.PATHS[2],200,1,json.dumps(self.ops)))
    def test_redirect_refused(self):
        self.assertIsNone(m.NoRedirect().redirect_request(None,None,302,'',{},'https://example.com'))
    def test_unknown_target(self):
        with self.assertRaises(ValueError): m.probe('https://example.com')

if __name__ == '__main__': unittest.main()
