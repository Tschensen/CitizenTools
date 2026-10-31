"""Native folder selection returns a draft and never changes runtime settings."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app import NativeApi


class NativeFolderTests(unittest.TestCase):
    def setUp(self):
        self.runtime = Mock()
        self.runtime.desktop_url = 'http://127.0.0.1:4174/?desktop=1&v=0.8.0'
        self.window = self.runtime.window
        self.window.get_current_url.return_value = self.runtime.desktop_url
        self.previous = str(Path.cwd() / 'PreviousInstall')
        self.selected = str(Path.cwd() / 'StarCitizen')
        self.runtime.settings = {'gameDirectory': self.previous, 'logEnabled': False}
        self.window.create_file_dialog.return_value = (self.selected,)
        self.api = NativeApi(self.runtime, [], Mock())
        self.webview = patch.dict(sys.modules, {'webview': SimpleNamespace(FileDialog=SimpleNamespace(FOLDER=20))})
        self.webview.start()
        self.addCleanup(self.webview.stop)

    def tearDown(self):
        self.runtime.save_settings.assert_not_called()
        self.assertEqual(self.runtime.settings, {'gameDirectory': self.previous, 'logEnabled': False})

    def test_selection_returns_draft_and_starts_in_explicit_folder(self):
        self.assertEqual(self.api.choose_game_directory(self.previous), {'ok': True, 'directory': self.selected})
        self.window.create_file_dialog.assert_called_once_with(20, directory=self.previous, allow_multiple=False)

    def test_cancel_keeps_settings_and_releases_dialog_lock(self):
        self.window.create_file_dialog.return_value = None
        self.assertEqual(self.api.choose_game_directory(self.previous), {'ok': True, 'cancelled': True})
        self.window.create_file_dialog.return_value = (self.selected,)
        self.assertTrue(self.api.choose_game_directory(self.previous)['ok'])

    def test_foreign_page_cannot_open_or_receive_folder_selection(self):
        self.window.get_current_url.return_value = 'https://example.com'
        self.assertEqual(self.api.choose_game_directory()['error'], 'directory_native_only')
        self.window.create_file_dialog.assert_not_called()
        self.window.get_current_url.side_effect = [self.runtime.desktop_url, 'https://example.com']
        self.assertEqual(self.api.choose_game_directory()['error'], 'directory_native_only')

    def test_invalid_typed_path_is_not_passed_to_dialog(self):
        self.assertTrue(self.api.choose_game_directory('../elsewhere')['ok'])
        self.window.create_file_dialog.assert_called_once_with(20, directory='', allow_multiple=False)

    def test_channel_folder_is_rejected(self):
        self.window.create_file_dialog.return_value = (str(Path(self.selected) / 'LIVE'),)
        self.assertEqual(self.api.choose_game_directory()['error'], 'directory_invalid')

    def test_concurrent_dialog_is_rejected(self):
        def select(*args, **kwargs):
            self.assertEqual(self.api.choose_game_directory()['error'], 'directory_busy')
            return (self.selected,)
        self.window.create_file_dialog.side_effect = select
        self.assertTrue(self.api.choose_game_directory()['ok'])
        self.window.create_file_dialog.assert_called_once()


if __name__ == '__main__':
    unittest.main()
