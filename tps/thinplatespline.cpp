/******************************************************************************
 * $Id: thinplatespline.cpp 15547 2008-10-17 17:45:03Z rouault $
 *
 * Project:  GDAL Warp API
 * Purpose:  Implemenentation of 2D Thin Plate Spline transformer.
 * Author:   VIZRT Development Team.
 *
 * This code was provided by Gilad Ronnen (gro at visrt dot com) with
 * permission to reuse under the following license.
 *
 ******************************************************************************
 * Copyright (c) 2004, VIZRT Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 ****************************************************************************/

#include "thinplatespline.h"
//#include <emscripten/bind.h>

#ifdef HAVE_FLOAT_H
#  include <float.h>
#elif defined(HAVE_VALUES_H)
#  include <values.h>
#endif

#ifndef FLT_MAX
#  define FLT_MAX 1e+37
#  define FLT_MIN 1e-37
#endif

VizGeorefSpline2D* viz_xy2llz;
VizGeorefSpline2D* viz_llz2xy;

/////////////////////////////////////////////////////////////////////////////////////
//// vizGeorefSpline2D
/////////////////////////////////////////////////////////////////////////////////////

#define A(r,c) _AA[ _nof_eqs * (r) + (c) ]
#define Ainv(r,c) _Ainv[ _nof_eqs * (r) + (c) ]


#define VIZ_GEOREF_SPLINE_DEBUG 0

int matrixInvert( int N, double input[], double output[] );

VizGeorefSpline2D::VizGeorefSpline2D(int nof_vars){
    x = y = u = NULL;
    unused = index = NULL;
    for( int i = 0; i < nof_vars; i++ )
    {
        rhs[i] = NULL;
        coef[i] = NULL;
    }
          
    _tx = _ty = 0.0;        
    _ta = 10.0;
    _nof_points = 0;
    _nof_vars = nof_vars;
    _max_nof_points = 0;
    _AA = NULL;
    _Ainv = NULL;
    grow_points();
    type = VIZ_GEOREF_SPLINE_ZERO_POINTS;
}

VizGeorefSpline2D::~VizGeorefSpline2D(){
    if ( _AA )
        free(_AA);
    if ( _Ainv )
        free(_Ainv);

    free( x );
    free( y );
    free( u );
    free( unused );
    free( index );
    for( int i = 0; i < _nof_vars; i++ )
    {
        free( rhs[i] );
        free( coef[i] );
    }
}

int VizGeorefSpline2D::get_nof_points(){
    return _nof_points;
}

int VizGeorefSpline2D::get_object_size(){
    return sizeof(VizGeorefSpline2D);
}

void VizGeorefSpline2D::set_toler( double tx, double ty ){
    _tx = tx;
    _ty = ty;
}

void VizGeorefSpline2D::get_toler( double& tx, double& ty) {
    tx = _tx;
    ty = _ty;
}

vizGeorefInterType VizGeorefSpline2D::get_interpolation_type ( ){
    return type;
}

void VizGeorefSpline2D::dump_data_points()
{
    for ( int i = 0; i < _nof_points; i++ )
    {
        fprintf(stderr, "X = %f Y = %f Vars = ", x[i], y[i]);
        for ( int v = 0; v < _nof_vars; v++ )
            fprintf(stderr, "%f ", rhs[v][i+3]);
        fprintf(stderr, "\n");
    }
}

int VizGeorefSpline2D::delete_list()
{
    _nof_points = 0;
    type = VIZ_GEOREF_SPLINE_ZERO_POINTS;
    if ( _AA )
    {
        free(_AA);
        _AA = NULL;
    }
    if ( _Ainv )
    {
        free(_Ainv);
        _Ainv = NULL;
    }
    return _nof_points;
}

void VizGeorefSpline2D::reset(void) { _nof_points = 0; }

void VizGeorefSpline2D::grow_points()

{
    int new_max = _max_nof_points*2 + 2 + 3;
    int i;

    if( _max_nof_points == 0 )
    {
        x = (double *) malloc( sizeof(double) * new_max );
        y = (double *) malloc( sizeof(double) * new_max );
        u = (double *) malloc( sizeof(double) * new_max );
        unused = (int *) malloc( sizeof(int) * new_max );
        index = (int *) malloc( sizeof(int) * new_max );
        for( i = 0; i < VIZGEOREF_MAX_VARS; i++ )
        {
            rhs[i] = (double *) calloc( sizeof(double), new_max );
            coef[i] = (double *) calloc( sizeof(double), new_max );
        }
    }
    else
    {
        x = (double *) realloc( x, sizeof(double) * new_max );
        y = (double *) realloc( y, sizeof(double) * new_max );
        u = (double *) realloc( u, sizeof(double) * new_max );
        unused = (int *) realloc( unused, sizeof(int) * new_max );
        index = (int *) realloc( index, sizeof(int) * new_max );
        for( i = 0; i < VIZGEOREF_MAX_VARS; i++ )
        {
            rhs[i] = (double *)
                realloc( rhs[i], sizeof(double) * new_max );
            coef[i] = (double *)
                realloc( coef[i], sizeof(double) * new_max );
        }
    }

    _max_nof_points = new_max - 3;
}

int VizGeorefSpline2D::add_point( const double Px, const double Py, const double *Pvars )
{
    type = VIZ_GEOREF_SPLINE_POINT_WAS_ADDED;
    int i;

    if( _nof_points == _max_nof_points )
        grow_points();

    i = _nof_points;
    //A new point is added
    x[i] = Px;
    y[i] = Py;
    for ( int j = 0; j < _nof_vars; j++ )
        rhs[j][i+3] = Pvars[j];
    _nof_points++;
    return 1;
}

bool VizGeorefSpline2D::change_point(int index, double Px, double Py, double* Pvars)
{
    if ( index < _nof_points )
    {
        int i = index;
        x[i] = Px;
        y[i] = Py;
        for ( int j = 0; j < _nof_vars; j++ )
            rhs[j][i+3] = Pvars[j];
    }

    return( true );
}

bool VizGeorefSpline2D::get_xy(int index, double& outX, double& outY)
{
    bool ok;

    if ( index < _nof_points )
    {
        ok = true;
        outX = x[index];
        outY = y[index];
    }
    else
    {
        ok = false;
        outX = outY = 0.0f;
    }

    return(ok);
}

int VizGeorefSpline2D::delete_point(const double Px, const double Py )
{
    for ( int i = 0; i < _nof_points; i++ )
    {
        if ( ( fabs(Px - x[i]) <= _tx ) && ( fabs(Py - y[i]) <= _ty ) )
        {
            for ( int j = i; j < _nof_points - 1; j++ )
            {
                x[j] = x[j+1];
                y[j] = y[j+1];
                for ( int k = 0; k < _nof_vars; k++ )
                    rhs[k][j+3] = rhs[k][j+3+1];
            }
            _nof_points--;
            type = VIZ_GEOREF_SPLINE_POINT_WAS_DELETED;
            return(1);
        }
    }
    return(0);
}

int VizGeorefSpline2D::solve(void)
{
    int r, c, v;
    int p;

    //	No points at all
    if ( _nof_points < 1 )
    {
        type = VIZ_GEOREF_SPLINE_ZERO_POINTS;
        return(0);
    }

    // Only one point
    if ( _nof_points == 1 )
    {
        type = VIZ_GEOREF_SPLINE_ONE_POINT;
        return(1);
    }
    // Just 2 points - it is necessarily 1D case
    if ( _nof_points == 2 )
    {
        _dx = x[1] - x[0];
        _dy = y[1] - y[0];
        double fact = 1.0 / ( _dx * _dx + _dy * _dy );
        _dx *= fact;
        _dy *= fact;

        type = VIZ_GEOREF_SPLINE_TWO_POINTS;
        return(2);
    }

    // More than 2 points - first we have to check if it is 1D or 2D case

    double xmax = x[0], xmin = x[0], ymax = y[0], ymin = y[0];
    double delx, dely;
    double xx, yy;
    double sumx = 0.0f, sumy= 0.0f, sumx2 = 0.0f, sumy2 = 0.0f, sumxy = 0.0f;
    double SSxx, SSyy, SSxy;

    for ( p = 0; p < _nof_points; p++ )
    {
        xx = x[p];
        yy = y[p];

        xmax = MAX( xmax, xx );
        xmin = MIN( xmin, xx );
        ymax = MAX( ymax, yy );
        ymin = MIN( ymin, yy );

        sumx  += xx;
        sumx2 += xx * xx;
        sumy  += yy;
        sumy2 += yy * yy;
        sumxy += xx * yy;
    }
    delx = xmax - xmin;
    dely = ymax - ymin;

    SSxx = sumx2 - sumx * sumx / _nof_points;
    SSyy = sumy2 - sumy * sumy / _nof_points;
    SSxy = sumxy - sumx * sumy / _nof_points;

    if ( delx < 0.001 * dely || dely < 0.001 * delx ||
         fabs ( SSxy * SSxy / ( SSxx * SSyy ) ) > 0.99 )
    {
        int p1;

        type = VIZ_GEOREF_SPLINE_ONE_DIMENSIONAL;

        _dx = _nof_points * sumx2 - sumx * sumx;
        _dy = _nof_points * sumy2 - sumy * sumy;
        double fact = 1.0 / sqrt( _dx * _dx + _dy * _dy );
        _dx *= fact;
        _dy *= fact;

        for ( p = 0; p < _nof_points; p++ )
        {
            double dxp = x[p] - x[0];
            double dyp = y[p] - y[0];
            u[p] = _dx * dxp + _dy * dyp;
            unused[p] = 1;
        }

        for ( p = 0; p < _nof_points; p++ )
        {
            int min_index = -1;
            double min_u = 0;
            for ( p1 = 0; p1 < _nof_points; p1++ )
            {
                if ( unused[p1] )
                {
                    if ( min_index < 0 || u[p1] < min_u )
                    {
                        min_index = p1;
                        min_u = u[p1];
                    }
                }
            }
            index[p] = min_index;
            unused[min_index] = 0;
        }

        return(3);
    }

    type = VIZ_GEOREF_SPLINE_FULL;
    // Make the necessary memory allocations
    if ( _AA )
        free(_AA);
    if ( _Ainv )
        free(_Ainv);

    _nof_eqs = _nof_points + 3;

    _AA = ( double * )calloc( _nof_eqs * _nof_eqs, sizeof( double ) );
    _Ainv = ( double * )calloc( _nof_eqs * _nof_eqs, sizeof( double ) );

    // Calc the values of the matrix A
    for ( r = 0; r < 3; r++ )
        for ( c = 0; c < 3; c++ )
            A(r,c) = 0.0;

    for ( c = 0; c < _nof_points; c++ )
    {
        A(0,c+3) = 1.0;
        A(1,c+3) = x[c];
        A(2,c+3) = y[c];

        A(c+3,0) = 1.0;
        A(c+3,1) = x[c];
        A(c+3,2) = y[c];
    }

    for ( r = 0; r < _nof_points; r++ )
        for ( c = r; c < _nof_points; c++ )
        {
            A(r+3,c+3) = base_func( x[r], y[r], x[c], y[c] );
            if ( r != c )
                A(c+3,r+3 ) = A(r+3,c+3);
        }

#if VIZ_GEOREF_SPLINE_DEBUG

    for ( r = 0; r < _nof_eqs; r++ )
    {
        for ( c = 0; c < _nof_eqs; c++ )
            fprintf(stderr, "%f", A(r,c));
        fprintf(stderr, "\n");
    }

#endif

    // Invert the matrix
    int status = matrixInvert( _nof_eqs, _AA, _Ainv );

    if ( !status )
    {
        // fprintf(stderr, " There is a problem to invert the interpolation matrix\n");
        return 0;
    }

    // calc the coefs
    for ( v = 0; v < _nof_vars; v++ )
        for ( r = 0; r < _nof_eqs; r++ )
        {
            coef[v][r] = 0.0;
            for ( c = 0; c < _nof_eqs; c++ )
                coef[v][r] += Ainv(r,c) * rhs[v][c];
        }

    return(4);
}

int VizGeorefSpline2D::get_point( const double Px, const double Py, double *vars )
{
	int v, r;
	double tmp, Pu;
	double fact;
	int leftP=0, rightP=0, found = 0;

	switch ( type )
	{
	case VIZ_GEOREF_SPLINE_ZERO_POINTS :
		for ( v = 0; v < _nof_vars; v++ )
			vars[v] = 0.0;
		break;
	case VIZ_GEOREF_SPLINE_ONE_POINT :
		for ( v = 0; v < _nof_vars; v++ )
			vars[v] = rhs[v][3];
		break;
	case VIZ_GEOREF_SPLINE_TWO_POINTS :
		fact = _dx * ( Px - x[0] ) + _dy * ( Py - y[0] );
		for ( v = 0; v < _nof_vars; v++ )
			vars[v] = ( 1 - fact ) * rhs[v][3] + fact * rhs[v][4];
		break;
	case VIZ_GEOREF_SPLINE_ONE_DIMENSIONAL :
		Pu = _dx * ( Px - x[0] ) + _dy * ( Py - y[0] );
		if ( Pu <= u[index[0]] )
		{
			leftP = index[0];
			rightP = index[1];
		}
		else if ( Pu >= u[index[_nof_points-1]] )
		{
			leftP = index[_nof_points-2];
			rightP = index[_nof_points-1];
		}
		else
		{
			for ( r = 1; !found && r < _nof_points; r++ )
			{
				leftP = index[r-1];
				rightP = index[r];
				if ( Pu >= u[leftP] && Pu <= u[rightP] )
					found = 1;
			}
		}

		fact = ( Pu - u[leftP] ) / ( u[rightP] - u[leftP] );
		for ( v = 0; v < _nof_vars; v++ )
			vars[v] = ( 1.0 - fact ) * rhs[v][leftP+3] +
			fact * rhs[v][rightP+3];
		break;
	case VIZ_GEOREF_SPLINE_FULL :
		for ( v = 0; v < _nof_vars; v++ )
			vars[v] = coef[v][0] + coef[v][1] * Px + coef[v][2] * Py;

		for ( r = 0; r < _nof_points; r++ )
		{
			tmp = base_func( Px, Py, x[r], y[r] );
			for ( v= 0; v < _nof_vars; v++ )
				vars[v] += coef[v][r+3] * tmp;
		}
		break;
	case VIZ_GEOREF_SPLINE_POINT_WAS_ADDED :
		fprintf(stderr, " A point was added after the last solve\n");
		fprintf(stderr, " NO interpolation - return values are zero\n");
		for ( v = 0; v < _nof_vars; v++ )
			vars[v] = 0.0;
		return(0);
		break;
	case VIZ_GEOREF_SPLINE_POINT_WAS_DELETED :
		fprintf(stderr, " A point was deleted after the last solve\n");
		fprintf(stderr, " NO interpolation - return values are zero\n");
		for ( v = 0; v < _nof_vars; v++ )
			vars[v] = 0.0;
		return(0);
		break;
	default :
		return(0);
		break;
	}
	return(1);
}

double VizGeorefSpline2D::base_func( const double x1, const double y1,
						  const double x2, const double y2 )
{
	if ( ( x1 == x2 ) && (y1 == y2 ) )
		return 0.0;

	double dist  = ( x2 - x1 ) * ( x2 - x1 ) + ( y2 - y1 ) * ( y2 - y1 );

	return dist * log( dist );
}

int VizGeorefSpline2D::serialize_size() 
{
    int  i_size     = sizeof(int);
    int  v_size     = sizeof(vizGeorefInterType);
    int  d_size     = sizeof(double);

    int  alloc_size = i_size * 5 + v_size + d_size * 5;
    int  p_num      = _max_nof_points + 3;
    int  is_aa      = 0;
    alloc_size      = alloc_size + ( i_size * 2 + d_size * ( 3 + VIZGEOREF_MAX_VARS * 2 ) ) * p_num;
    int  a_num      = _nof_eqs * _nof_eqs;
    if (_AA) {
        alloc_size  = alloc_size + ( d_size * a_num * 2 );
    }

    return alloc_size;
}

char* VizGeorefSpline2D::serialize(char* serial) 
{
    int  i_size     = sizeof(int);
    int  v_size     = sizeof(vizGeorefInterType);
    int  d_size     = sizeof(double);
    int  alloc_size = serialize_size();
    int  p_num      = _max_nof_points + 3;
    int  is_aa      = 0;
    int  a_num      = _nof_eqs * _nof_eqs;
    if (_AA) {
        is_aa       = 1;
    }

    //cout << _nof_vars << endl;
    //cout << _nof_points << endl;
    //cout << _max_nof_points << endl;
    //cout << _nof_eqs << endl;

    char *work      = serial;
    memcpy(work,              &_nof_vars,       i_size);
    memcpy(work + i_size,     &_nof_points,     i_size);   
    memcpy(work + i_size * 2, &_max_nof_points, i_size);
    memcpy(work + i_size * 3, &_nof_eqs,        i_size);
    memcpy(work + i_size * 4, &is_aa,           i_size);
    work            = work + i_size * 5;
    memcpy(work,              &type,            v_size);
    work            = work + v_size;
    memcpy(work,              &_tx,             d_size);
    memcpy(work + d_size,     &_ty,             d_size);   
    memcpy(work + d_size * 2, &_ta,             d_size);
    memcpy(work + d_size * 3, &_dx,             d_size);
    memcpy(work + d_size * 4, &_dy,             d_size);
    work            = work + d_size * 5;    

    for (int i=0;i<p_num;i++) {
        memcpy(work,          &unused[i],       i_size);
        memcpy(work + i_size, &index[i],        i_size);
        work        = work + i_size * 2;

        memcpy(work,              &x[i],        d_size);
        memcpy(work + d_size,     &y[i],        d_size);
        memcpy(work + d_size * 2, &u[i],        d_size);
        work        = work + d_size * 3;
        
        for (int j=0;j<VIZGEOREF_MAX_VARS;j++) {
            memcpy(work,          &rhs[j][i],   d_size);
            memcpy(work + d_size, &coef[j][i],  d_size);
            work        = work + d_size * 2; 
        }
    }

    if (is_aa) {
        for (int i=0;i<a_num;i++) {
            memcpy(work,          &_AA[i],      d_size);
            memcpy(work + d_size, &_Ainv[i],    d_size);
            work        = work + d_size * 2; 
        }
    }

    return work;
}

char* VizGeorefSpline2D::deserialize(char* serial) 
{
    int  i_size     = sizeof(int);
    int  v_size     = sizeof(vizGeorefInterType);
    int  d_size     = sizeof(double);
    int  is_aa;

    if ( _AA ) {
        free(_AA);
        _AA   = NULL;
    }
    if ( _Ainv ) {
        free(_Ainv);
        _Ainv = NULL;
    }
    free( x );
    free( y );
    free( u );
    free( unused );
    free( index );
    for ( int i = 0; i < VIZGEOREF_MAX_VARS; i++ )
    {
        free( rhs[i] );
        free( coef[i] );
    }

    char *work      = serial;
    memcpy(&_nof_vars,       work,              i_size);
    memcpy(&_nof_points,     work + i_size,     i_size);   
    memcpy(&_max_nof_points, work + i_size * 2, i_size);
    memcpy(&_nof_eqs,        work + i_size * 3, i_size);
    memcpy(&is_aa,           work + i_size * 4, i_size);
    work            = work + i_size * 5;
    memcpy(&type,            work,              v_size);
    work            = work + v_size;
    memcpy(&_tx,             work,              d_size);
    memcpy(&_ty,             work + d_size,     d_size);   
    memcpy(&_ta,             work + d_size * 2, d_size);
    memcpy(&_dx,             work + d_size * 3, d_size);
    memcpy(&_dy,             work + d_size * 4, d_size);
    work            = work + d_size * 5;

    //cout << _nof_vars << endl;
    //cout << _nof_points << endl;
    //cout << _max_nof_points << endl;
    //cout << _nof_eqs << endl;

    int  alloc_size = i_size * 5 + v_size + d_size * 5;
    int  p_num      = _max_nof_points + 3;
    alloc_size      = alloc_size + ( i_size * 2 + d_size * ( 3 + VIZGEOREF_MAX_VARS * 2 ) ) * p_num;
    int  a_num      = _nof_eqs * _nof_eqs;
    if (is_aa) {
        alloc_size  = alloc_size + ( d_size * a_num * 2 );
    }

    x      = (double *) malloc( d_size * p_num );
    y      = (double *) malloc( d_size * p_num );
    u      = (double *) malloc( d_size * p_num );
    unused = (int *)    malloc( i_size * p_num );
    index  = (int *)    malloc( i_size * p_num );
    for ( int i = 0; i < VIZGEOREF_MAX_VARS; i++ )
    {
        rhs[i]  = (double *) calloc( d_size, p_num );
        coef[i] = (double *) calloc( d_size, p_num );
    }

    for (int i=0;i<p_num;i++) {
        memcpy(&unused[i],       work,          i_size);
        memcpy(&index[i],        work + i_size, i_size);
        work        = work + i_size * 2;

        memcpy(&x[i],        work,              d_size);
        memcpy(&y[i],        work + d_size,     d_size);
        memcpy(&u[i],        work + d_size * 2, d_size);
        work        = work + d_size * 3;
        
        for (int j=0;j<VIZGEOREF_MAX_VARS;j++) {
            memcpy(&rhs[j][i],  work,          d_size);
            memcpy(&coef[j][i], work + d_size, d_size);
            work        = work + d_size * 2; 
        }
    }

    if (is_aa) {
        _AA      = (double *) malloc( d_size * a_num );
        _Ainv    = (double *) malloc( d_size * a_num );

        for (int i=0;i<a_num;i++) {
            memcpy(&_AA[i],      work,          d_size);
            memcpy(&_Ainv[i],    work + d_size, d_size);
            work        = work + d_size * 2; 
        }
    }

    return work;
}

int matrixInvert( int N, double input[], double output[] )
{
    // Receives an array of dimension NxN as input.  This is passed as a one-
    // dimensional array of N-squared size.  It produces the inverse of the
    // input matrix, returned as output, also of size N-squared.  The Gauss-
    // Jordan Elimination method is used.  (Adapted from a BASIC routine in
    // "Basic Scientific Subroutines Vol. 1", courtesy of Scott Edwards.)

    // Array elements 0...N-1 are for the first row, N...2N-1 are for the
    // second row, etc.

    // We need to have a temporary array of size N x 2N.  We'll refer to the
    // "left" and "right" halves of this array.

    int row, col;

#if 0
    fprintf(stderr, "Matrix Inversion input matrix (N=%d)\n", N);
    for ( row=0; row<N; row++ )
    {
        for ( col=0; col<N; col++ )
        {
            fprintf(stderr, "%5.2f ", input[row*N + col ]  );
        }
        fprintf(stderr, "\n");
    }
#endif

    int tempSize = 2 * N * N;
    double* temp = (double*) new double[ tempSize ];
    double ftemp;

    if (temp == 0) {

        fprintf(stderr, "matrixInvert(): ERROR - memory allocation failed.\n");
        return false;
    }

    // First create a double-width matrix with the input array on the left
    // and the identity matrix on the right.

    for ( row=0; row<N; row++ )
    {
        for ( col=0; col<N; col++ )
        {
            // Our index into the temp array is X2 because it's twice as wide
            // as the input matrix.

            temp[ 2*row*N + col ] = input[ row*N+col ];	// left = input matrix
            temp[ 2*row*N + col + N ] = 0.0f;			// right = 0
        }
        temp[ 2*row*N + row + N ] = 1.0f;		// 1 on the diagonal of RHS
    }

    // Now perform row-oriented operations to convert the left hand side
    // of temp to the identity matrix.  The inverse of input will then be
    // on the right.

    int max;
    int k=0;
    for (k = 0; k < N; k++)
    {
        if (k+1 < N)	// if not on the last row
        {
            max = k;
            for (row = k+1; row < N; row++) // find the maximum element
            {
                if (fabs( temp[row*2*N + k] ) > fabs( temp[max*2*N + k] ))
                {
                    max = row;
                }
            }

            if (max != k)	// swap all the elements in the two rows
            {
                for (col=k; col<2*N; col++)
                {
                    ftemp = temp[k*2*N + col];
                    temp[k*2*N + col] = temp[max*2*N + col];
                    temp[max*2*N + col] = ftemp;
                }
            }
        }

        ftemp = temp[ k*2*N + k ];
        if ( ftemp == 0.0f ) // matrix cannot be inverted
        {
            delete[] temp;
            return false;
        }

        for ( col=k; col<2*N; col++ )
        {
            temp[ k*2*N + col ] /= ftemp;
        }

        for ( row=0; row<N; row++ )
        {
            if ( row != k )
            {
                ftemp = temp[ row*2*N + k ];
                for ( col=k; col<2*N; col++ )
                {
                    temp[ row*2*N + col ] -= ftemp * temp[ k*2*N + col ];
                }
            }
        }
    }

    // Retrieve inverse from the right side of temp

    for (row = 0; row < N; row++)
    {
        for (col = 0; col < N; col++)
        {
            output[row*N + col] = temp[row*2*N + col + N ];
        }
    }

#if 0
    fprintf(stderr, "Matrix Inversion result matrix:\n");
    for ( row=0; row<N; row++ )
    {
        for ( col=0; col<N; col++ )
        {
            fprintf(stderr, "%5.2f ", output[row*N + col ]  );
        }
        fprintf(stderr, "\n");
    }
#endif

    delete [] temp;       // free memory
    return true;
}

/*EMSCRIPTEN_BINDINGS(thinplatespline) {
    emscripten::class_<VizGeorefSpline2D>("_TPS")
        .constructor<int>()
        .function("add_point", &VizGeorefSpline2D::add_point, emscripten::allow_raw_pointers())
        .function("solve", &VizGeorefSpline2D::solve)
        .function("get_point", &VizGeorefSpline2D::get_point, emscripten::allow_raw_pointers())
        .function("serialize_size", &VizGeorefSpline2D::serialize_size)
        .function("serialize", &VizGeorefSpline2D::serialize, emscripten::allow_raw_pointers())
        .function("deserialize", &VizGeorefSpline2D::deserialize, emscripten::allow_raw_pointers())
        ;
}*/
