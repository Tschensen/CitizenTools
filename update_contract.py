"""Package names and compatibility shared by builder, app and update helper."""

FULL_ASSETS = {'portable': 'CitizenTools-Solo-Portable.zip', 'installer': 'CitizenTools-Solo-Setup.exe'}
UPDATE_ASSETS = {'portable': 'CitizenTools-Solo-Update.zip', 'installer': 'CitizenTools-Solo-Update.exe'}
UPDATE_FORMAT = 1
PLATFORM = 'windows-x64'


def update_manifest(modes):
    return {'format': UPDATE_FORMAT, 'platform': PLATFORM,
            'assets': {mode: UPDATE_ASSETS[mode] for mode in modes}}


def compatible_update(manifest, mode):
    """Unknown future formats/platforms fall back to the complete package."""
    options = manifest.get('updates')
    if not isinstance(options, dict) or type(options.get('format')) is not int:
        return None
    if options['format'] != UPDATE_FORMAT or options.get('platform') != PLATFORM:
        return None
    assets = options.get('assets')
    if not isinstance(assets, dict) or mode not in assets:
        return None
    if assets[mode] != UPDATE_ASSETS[mode]:
        raise ValueError('Invalid update package name')
    return assets[mode]
