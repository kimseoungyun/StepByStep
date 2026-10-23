from django.shortcuts import render, redirect


def home(request):
    return render(request, 'main/analyze.html')


def legacy_redirect(request):
    # Do not expose historical shared result.json as a user result.
    return redirect('home')
