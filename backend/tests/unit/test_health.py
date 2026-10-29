def test_health_is_liveness_only(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_scaffold_info(client):
    response = client.get("/api/v1/system/info")
    assert response.status_code == 200
    assert response.json()["phase"] == "scaffold"
