from django.test import SimpleTestCase


class AnalysisPagesTests(SimpleTestCase):
    def test_home_and_detect_render_without_tensorflow(self):
        for path in ('/', '/detect/'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, 'main/analyze.mjs')
            self.assertContains(response, 'id="file"')
            self.assertNotContains(response, 'result.json')

    def test_old_shared_result_routes_redirect_to_new_analysis(self):
        for path in ('/url/', '/qr/', '/camera/'):
            self.assertRedirects(self.client.get(path), '/')
