from app.core.security import CredentialVault, get_credential_vault


def get_vault() -> CredentialVault:
    return get_credential_vault()
