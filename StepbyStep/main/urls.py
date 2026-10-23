from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('detect/', views.home, name='detect'),
    path('qr/', views.legacy_redirect, name='qr'),
    path('url/', views.legacy_redirect, name='url'),
    path('camera/', views.legacy_redirect, name='camera'),
]
