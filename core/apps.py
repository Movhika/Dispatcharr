from django.apps import AppConfig
import logging

# Define TRACE level (5 is below DEBUG which is 10)
TRACE = 5
logging.addLevelName(TRACE, "TRACE")

# Add trace method to the Logger class
def trace(self, message, *args, **kwargs):
    """Log a message with TRACE level (more detailed than DEBUG)"""
    if self.isEnabledFor(TRACE):
        self._log(TRACE, message, args, **kwargs)

# Add the trace method to the Logger class
logging.Logger.trace = trace


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # Import signals to ensure they get registered
        import core.signals
        from dispatcharr.app_initialization import should_skip_initialization

        if not should_skip_initialization():
            self._initialize_runtime_state()

    def _initialize_runtime_state(self, **kwargs):
        """Apply database-backed settings in the initializing web process."""
        from django.db import close_old_connections
        from django.conf import settings
        from core.models import CoreSettings, SYSTEM_SETTINGS_KEY
        from core.developer_notifications import sync_developer_notifications
        from dispatcharr.log_collector import apply_settings

        try:
            apply_settings(
                getattr(settings, "LOG_FILE_DIR", None),
                CoreSettings.objects.filter(key=SYSTEM_SETTINGS_KEY)
                .values_list("value", flat=True)
                .first()
                or {},
            )
        except Exception:
            # Database not migrated yet: the collector keeps its defaults.
            pass

        try:
            sync_developer_notifications()
        except Exception as e:
            logging.getLogger(__name__).warning(
                "Failed to initialize core runtime state: %s", e
            )
        finally:
            close_old_connections()
