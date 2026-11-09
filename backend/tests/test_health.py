from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_health_reports_database_status():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["database"] is True
    assert body["status"] == "ok"
