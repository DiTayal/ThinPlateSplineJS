/******************************************************************************
 * tps.h
 *
 * Project:  thinplatespline
 * Purpose:  Wrapper implemenentation of 2D Thin Plate Spline transformer.
 * Author:   Ko Nagase, geosanak@gmail.com
 *
 ******************************************************************************
 * Copyright (c) 2011, Omniscale GmbH & Co. KG
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

// Thin Plate Spline computation class.
class TPS
{
private:
    VizGeorefSpline2D *_sp;
    bool _solved;
public:
    TPS(double* points = NULL, int count = 0)
    {
        this->_sp = new VizGeorefSpline2D(2);
        this->_solved = false;
        if (points && count > 0)
        {
            for (int i = 0; i < count; i++)
            {
                double* p = points + (i * 4);
                this->add(p[0], p[1], p[2], p[3]);
            }
        }
    }

    virtual ~TPS()
    {
        if (this->_sp != NULL)
        {
            delete this->_sp;
            this->_sp = NULL;
        }
    }

    // Add a control point for the TPS.
    // 
    // :param src_x: x value of the source point
    // :param src_y: y value of the source point
    // :param dst_x: x value of the destination point
    // :param dst_y: y value of the destination point
    void add(double src_x, double src_y, double dst_x, double dst_y)
    {
        double dst[2];
        dst[0] = dst_x;
        dst[1] = dst_y;
        this->_sp->add_point(src_x, src_y, dst);
        this->_solved = false;
    }

    // Calculate TPS. Raises TPSError if TPS could not be solved.
    void solve()
    {
        int result = this->_sp->solve();
        if (!result)
        {
            throw "could not solve thin plate spline";
        }
        this->_solved = true;
    }

    // Transform from source point to destination.
    // 
    // :param src_x: x value of the source point
    // :param src_y: y value of the source point
    // :param dst: returns x and y values of the transformed point
    void transform(double src_x, double src_y, double dst[2])
    {
        if (!this->_solved)
        {
            this->solve();
        }
        this->_sp->get_point(src_x, src_y, dst);
    }

    int serialize_size()
    {
        return this->_sp->serialize_size();
    }

    char* serialize(char* serial)
    {
        return this->_sp->serialize(serial);
    }

    char* deserialize(char* serial)
    {
        return this->_sp->deserialize(serial);
    }

    static TPS* from_control_points(double* points, int count, bool backwards = false)
    {
        TPS* t = new TPS();
        for (int i = 0; i < count; i++)
        {
            double* p = points + (i * 4);
            if (backwards)
            {
                t->add(p[2], p[3], p[0], p[1]);
            }
            else
            {
                t->add(p[0], p[1], p[2], p[3]);
            }
        }

        return t;
    }
};